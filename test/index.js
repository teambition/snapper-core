'use strict'

const tman = require('tman')
const net = require('toa-net')
const config = require('config')
const assert = require('assert')
const thunk = require('thunks')()
const request = require('supertest')
const ThunkQueue = require('thunk-queue')
const Producer = require('snapper-producer')

const app = require('../app')
const rpc = require('../rpc')
const tool = require('../lib/tool')
const redis = require('../lib/service/redis')
const stats = require('../lib/service/stats')
const Consumer = require('./lib/consumer')

const redisClient = redis.defaultClient

var producerId = 0

tman.suite('snapper2', function () {
  this.timeout(5000)

  tman.before(function * () {
    yield redisClient.flushall()
  })

  tman.after(function * () {
    yield redisClient.flushall()
  })

  tman.suite('rpc', function () {
    tman.it('connect:Unauthorized', function (callback) {
      let producer = new Producer(config.rpcPort, {
        secretKeys: 'xxx',
        producerId: ++producerId + ''
      })

      producer
        .on('connect', function () {
          assert.strictEqual('Should not run', true)
        })
        .on('error', function (err) {
          assert.strictEqual(err.code, 401)
        })
        .on('close', callback)
    })

    tman.it('connect:success', function (callback) {
      let producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })

      producer
        .on('connect', function () {
          this.close()
        })
        .on('error', function (err) {
          assert.strictEqual('Should not run', err)
        })
        .on('close', callback)
    })

    tman.it('signAuth', function (callback) {
      let producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })

      let token = producer.signAuth({test: true})
      assert.strictEqual(app.verifyToken(token).test, true)

      producer
        .on('connect', function () {
          this.close()
        })
        .on('error', function () {
          assert.strictEqual('Should not run', true)
        })
        .on('close', callback)
    })

    tman.it('sendMessage', function (callback) {
      let producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })

      let count = 0
      producer
        .on('jsonrpc', function (obj) {
          if (obj.result > 0) count += obj.result
          if (count === this.connection.messagesCount) producer.close()
        })
        .on('close', callback)
        .sendMessage('test', 'a')
        .sendMessage('test', 'b')
        .sendMessage('test', 'c')
    })

    tman.it('joinRoom, leaveRoom', function (callback) {
      let producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })

      producer
        .on('error', callback)
        .on('close', callback)

      // should work will callback style or thunk style
      producer.joinRoom = thunk.thunkify(producer.joinRoom)
      // producer.leaveRoom = thunk.thunkify(producer.leaveRoom)

      thunk(producer.joinRoom('room', 123))(function (err, res) {
        assert.strictEqual(err instanceof Error, true)
        return producer.joinRoom(123, 123)
      })(function (err, res) {
        assert.strictEqual(err instanceof Error, true)
        return producer.joinRoom('room', '')
      })(function (err, res) {
        assert.strictEqual(err instanceof Error, true)
      })(function * () {
        let res = yield producer.joinRoom('test', '1')
        assert.strictEqual(res, 1)

        res = yield producer.joinRoom('test', '2')
        assert.strictEqual(res, 1)

        res = yield producer.leaveRoom('test', '1')
        assert.strictEqual(res, 1)
      })(function (err) {
        if (err) return callback(err)
        producer.close()
      })
    })

    tman.it('request', function (callback) {
      let producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })

      producer
        .on('error', callback)
        .on('close', callback)

      thunk(producer.request('get', 123))(function (err, res) {
        assert.strictEqual(err instanceof Error, true)
        assert.strictEqual(err.message, 'Invalid params')
        return producer.request('get', [])
      })(function (err, res) {
        assert.strictEqual(err instanceof Error, true)
        assert.strictEqual(err.message, 'Method not found')
        return producer.request('consumers', [])
      })(function (err, res) {
        assert.strictEqual(err instanceof Error, true)
        assert.strictEqual(err.message, 'Invalid params')
        return producer.request('consumers', ['userIdxxx'])
      })(function * (err, res) {
        assert.strictEqual(err, null)
        assert.deepEqual(res, {length: 0, android: 0, web: 0, ios: 0})

        let consumer = yield function (done) {
          let host = '127.0.0.1:' + config.port
          let userId = Consumer.genUserId()
          let token = producer.signAuth({userId: userId})
          let consumer = new Consumer(host, {
            path: '/websocket',
            token: token
          })
          consumer.onerror = function () {
            assert.strictEqual('Should not run', true)
          }
          consumer.onopen = function () {
            this.userId = userId
            done(null, this)
          }
          consumer.connect()
        }

        assert.strictEqual(consumer instanceof Consumer, true)

        yield thunk.delay(200)
        res = yield producer.request('consumers', [consumer.userId])
        assert.deepEqual(res, {length: 1, android: 0, ios: 0, web: 1})
        consumer.close()
        producer.close()
      })(callback)
    })

    tman.it('reconnecting', function (callback) {
      let producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })
      let reconnecting = false

      producer
        .on('error', function (err) {
          assert.strictEqual(err instanceof Error, true)
        })
        .on('connect', function () {
          if (reconnecting) producer.close()
          else rpc.close(() => rpc.listen(config.rpcPort))
        })
        .on('reconnecting', function () {
          reconnecting = true
        })
        .on('close', function () {
          callback()
        })
    })

    tman.it('close', function (callback) {
      let producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })
      let hadError = false

      producer
        .on('error', function (err) {
          hadError = err
        })
        .on('close', function () {
          assert.strictEqual(hadError instanceof Error, true)
          callback()
        })
        .on('connect', function () {
          producer.sendMessage('test', '12345')
          this.close()
        })
    })
  })

  tman.suite('ws', function () {
    let producer = null
    let host = '127.0.0.1:' + config.port

    tman.before(function (callback) {
      producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })
      producer
        .on('error', callback)
        .on('connect', callback)
    })

    tman.after(function () {
      producer.close()
    })

    tman.it('session2ID', function () {
      const auth = new net.Auth(config.tokenSecret)
      let session = auth.decode(auth.sign({userId: Consumer.genUserId()}))
      let id = tool.session2ID(session)
      assert.strictEqual(/snapper\.ws=([0-9a-zA-Z.~_-]{24,38})/.test(`snapper.ws=${id}`), true)
    })

    tman.it('connect:Unauthorized', function (callback) {
      let consumer = new Consumer(host, {
        path: '/websocket',
        token: 'errorToken'
      })

      consumer.onopen = function () {
        assert.strictEqual('Should not run', true)
      }
      consumer.onerror = function (err) {
        assert.strictEqual(!!err, true)
        this.close()
      }
      consumer.onclose = callback
      consumer.connect()
    })

    tman.it('connect:success', function (callback) {
      let token = producer.signAuth({userId: Consumer.genUserId()})
      let consumer = new Consumer(host, {
        path: '/websocket',
        token: token
      })

      consumer.onopen = function () {
        this.close()
      }
      consumer.onerror = function () {
        assert.strictEqual('Should not run', true)
      }
      consumer.onclose = callback
      consumer.connect()
    })

    tman.it('echo request', function (callback) {
      let token = producer.signAuth({userId: Consumer.genUserId()})
      let consumer = new Consumer(host, {
        path: '/websocket',
        token: token
      })
      consumer.onerror = function () {
        assert.strictEqual('Should not run', true)
      }
      consumer.onclose = callback
      consumer.request('echo', [1, 2, 3], function (err, res) {
        assert.strictEqual(err == null, true)
        assert.deepEqual(res, [1, 2, 3])
        consumer.close()
      })
      consumer.connect()
    })

    tman.it('invalid echo request', function (callback) {
      let token = producer.signAuth({userId: Consumer.genUserId()})
      let consumer = new Consumer(host, {
        path: '/websocket',
        token: token
      })
      consumer.onerror = function () {
        assert.strictEqual('Should not run', true)
      }
      consumer.onclose = callback
      consumer.request('test', undefined, callback)
      consumer.connect()
    })

    tman.it('update user consumer state', function * () {
      let userId = Consumer.genUserId()

      function addConsumer (id) {
        return function (done) {
          let token = producer.signAuth({userId: userId, id: id})
          let consumer = new Consumer(host, {
            path: '/websocket',
            token: token
          })
          consumer.onerror = function () {
            assert.strictEqual('Should not run', true)
          }
          consumer.onopen = function () {
            done(null, this)
          }
          consumer.connect()
        }
      }

      let res = null
      yield thunk.delay(200)
      res = yield producer.request('consumers', [userId])
      assert.deepEqual(res, {length: 0, android: 0, web: 0, ios: 0})

      let consumer1 = yield addConsumer(1)
      yield thunk.delay(200)
      res = yield producer.request('consumers', [userId])
      assert.deepEqual(res, {length: 1, android: 0, ios: 0, web: 1})

      let consumer2 = yield addConsumer(2)
      yield thunk.delay(200)
      res = yield producer.request('consumers', [userId])
      assert.deepEqual(res, {length: 2, android: 0, ios: 0, web: 2})

      let consumer3 = yield addConsumer(3)
      yield thunk.delay(200)
      res = yield producer.request('consumers', [userId])
      assert.deepEqual(res, {length: 3, android: 0, ios: 0, web: 3})

      consumer2.close()
      yield thunk.delay(100)
      res = yield producer.request('consumers', [userId])
      assert.deepEqual(res, {length: 2, android: 0, ios: 0, web: 2})

      consumer1.close()
      yield thunk.delay(100)
      res = yield producer.request('consumers', [userId])
      assert.deepEqual(res, {length: 1, android: 0, ios: 0, web: 1})

      consumer3.close()
      yield thunk.delay(100)
      res = yield producer.request('consumers', [userId])
      assert.deepEqual(res, {length: 0, android: 0, ios: 0, web: 0})
    })

    tman.it('receive message in order', function (callback) {
      let userId = Consumer.genUserId()
      let token = producer.signAuth({userId: userId})
      let consumer = new Consumer(host, {
        path: '/websocket',
        token: token
      })
      let res = []

      consumer.onopen = function () {
        let room = `user${userId}`
        // wait for consumer join user room!
        thunk.delay(200)(function () {
          producer
            .sendMessage(room, JSON.stringify(1))
            .sendMessage(room, JSON.stringify(2))
            .sendMessage(room, JSON.stringify(3))
            .sendMessage(room, JSON.stringify(4))
            .sendMessage(room, JSON.stringify(5))
            .sendMessage(room, JSON.stringify('end'))
        })
      }

      consumer.message = function (message) {
        if (message === 'end') {
          assert.deepEqual(res, [1, 2, 3, 4, 5])
          this.close()
        } else res.push(message)
      }

      consumer.onerror = function (err) {
        console.error(err)
        callback(err)
      }

      consumer.onclose = callback
      consumer.connect()
    })

    tman.it('join room and receive message', function (callback) {
      let userId = Consumer.genUserId()
      let token = producer.signAuth({userId: userId})
      let consumer = new Consumer(host, {
        path: '/websocket',
        token: token
      })
      let res = []

      consumer.onopen = function () {
        producer.joinRoom('test', consumer.consumerId)()
        producer.sendMessage('test', JSON.stringify({
          e: 'update',
          d: 0
        }))
        .sendMessage('test', JSON.stringify({
          e: 'update',
          d: '0'
        }))
        .sendMessage('test', JSON.stringify({
          e: 'update',
          d: false
        }))
        .sendMessage('test', JSON.stringify({
          e: 'update',
          d: {}
        }))
        .sendMessage('test', JSON.stringify({
          e: 'update',
          d: []
        }))
        .sendMessage('test', JSON.stringify({
          e: 'update',
          d: null
        }))
      }

      consumer.message = function (message) {
        assert.strictEqual(message.e, 'update')
        if (message.d === null) {
          assert.deepEqual(res, [0, '0', false, {}, []])
          this.close()
        } else res.push(message.d)
      }

      consumer.onerror = function (err) {
        console.error(err)
        callback(err)
      }

      consumer.onclose = callback
      consumer.connect()
    })

    tman.it('reconnect and receive message', function (callback) {
      let userId = Consumer.genUserId()
      let token = producer.signAuth({userId: userId})
      let consumer = new Consumer(host, {
        path: '/websocket',
        token: token
      })
      let res = []

      consumer.onopen = function () {
        producer.joinRoom('test', consumer.consumerId)()
        producer.sendMessage('test', JSON.stringify(1))
          .sendMessage('test', JSON.stringify(2))
          .sendMessage('test', JSON.stringify(3))
          .sendMessage('test', JSON.stringify(4))
          .sendMessage('test', JSON.stringify(5))
          .sendMessage('test', JSON.stringify(null))
      }

      consumer.message = function (message) {
        if (message === null) {
          assert.deepEqual(res, [1, 2, 3, 4, 5])
          this.close()
        } else res.push(message)
      }

      consumer.onerror = function (err) {
        console.error(err)
        callback(err)
      }

      consumer.onclose = function () {
        thunk.delay(1000)(function () {
          producer
            .sendMessage('test', JSON.stringify(6))
            .sendMessage('test', JSON.stringify(7))
            .sendMessage('test', JSON.stringify(8))
            .sendMessage('test', JSON.stringify(9))
            .sendMessage('test', JSON.stringify(10))
            .sendMessage('test', JSON.stringify(null))

          let consumer = new Consumer(host, {
            path: '/websocket',
            token: token
          })

          consumer.message = function (message) {
            if (message === null) {
              assert.deepEqual(res, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
              this.close()
            } else res.push(message)
          }

          consumer.onerror = function (err) {
            console.error(err)
            callback(err)
          }
          consumer.onclose = callback
          consumer.connect()
        })()
      }

      consumer.connect()
    })

    tman.it.skip('ignore excess messages(2048)', function (callback) {
      let userId = Consumer.genUserId()
      let token = producer.signAuth({userId: userId})
      let consumer = new Consumer(host, {
        path: '/websocket',
        token: token
      })
      let res = []

      consumer.onopen = function () {
        // reset onpen
        consumer.onopen = function () {}

        let room = `user${userId}`
        // wait for consumer join user room!
        thunk.delay(200)(function * () {
          consumer.close()
          yield thunk.delay(200)

          for (let i = 0; i < 4096; i++) {
            producer.sendMessage(room, JSON.stringify(i))
          }

          yield thunk.delay(200)
          consumer.connect()

          yield thunk.delay(1000)
          assert.strictEqual(res.length < 2048 * 1.5, true)
        })(callback)
      }

      consumer.message = function (message) {
        res.push(message)
      }

      consumer.onerror = callback
      consumer.connect()
    })
  })

  tman.suite('stats && chaos', function () {
    this.timeout(50000)

    let producer = null
    let host = '127.0.0.1:' + config.port

    tman.before(function (callback) {
      producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })
      producer
        .on('error', function (err) {
          console.error(err)
        })
        .once('connect', callback)
    })

    tman.it('2000 messages with server restart', function (callback) {
      let received = []
      let messages = []
      while (messages.length < 2000) messages.push(messages.length)

      let userId = Consumer.genUserId()
      let consumer = new Consumer(host, {
        path: '/websocket',
        transports: ['websocket'], // easy to trigger "xhr poll error"
        token: producer.signAuth({userId: userId})
      })
      consumer.message = function (message) {
        if (message === null) {
          assert.deepEqual(received, messages)
          this.close()
        } else received.push(message)
      }
      consumer.onclose = callback
      consumer.connect()

      thunk(function * () {
        // wait for consumer join user room!
        yield thunk.delay(500)
        let _messages = messages.slice()
        while (_messages.length) {
          if (_messages.length === 1000) restartServer()
          let random = Math.ceil(Math.random() * 10)
          // 等待 random 毫秒
          yield thunk.delay(random)
          producer.sendMessage(`user${userId}`, JSON.stringify(_messages.shift()))
          if (_messages.length % 100 === 0) process.stdout.write('.')
        }
        producer.sendMessage(`user${userId}`, JSON.stringify(null))
      })()

      function restartServer () {
        rpc.close()
        thunk.delay(1000)(function () {
          rpc.listen(config.rpcPort)
        })
      }
    })

    tman.it('1000 messages to 200 consumers', function * () {
      let consumers = []
      let messages = []
      while (messages.length < 1000) messages.push(messages.length)
      while (consumers.length < 200) {
        consumers.push(new Consumer(host, {
          path: '/websocket',
          transports: ['websocket'], // easy to trigger "xhr poll error"
          token: producer.signAuth({userId: Consumer.genUserId()})
        }))
      }

      // 注册 consumers 消息处理器
      let thunkQueue = ThunkQueue()
      // 等待 consumers 连接并加入 chaos room
      yield consumers.map(function (consumer) {
        let received = []
        thunkQueue.push(thunk(function (done) {
          consumer.message = function (message) {
            if (message === null) {
              assert.deepEqual(received, messages)
              done()
            } else {
              received.push(message)
            }
          }
          consumer.onerror = done
          // consumer.onclose = done
        })(function (err) {
          if (err) throw err
        }))

        return thunk(function (done) {
          consumer.onopen = function () {
            producer.joinRoom('chaos', consumer.consumerId, done)
          }
          consumer.connect()
        })
      })

      // 开始发送消息
      let _messages = messages.slice()
      while (_messages.length) {
        let random = Math.ceil(Math.random() * 100)
        // 等待 random 毫秒
        yield thunk.delay(random)
        // 并发发送 random  条消息
        let todo = _messages.splice(0, random)
        // console.log('send:', todo.length, 'left:', _messages.length)
        while (todo.length) producer.sendMessage('chaos', JSON.stringify(todo.shift()))
        process.stdout.write('.')
      }
      producer.sendMessage('chaos', JSON.stringify(null))

      // 等待 consumers 所有消息处理完毕
      yield thunkQueue.end()

      // get stats
      let res = yield request(app.server).get(`/stats?token=${producer.signAuth({name: 'snapper'})}`)
      let info = res.body.stats
      assert.strictEqual(info.total.producerMessages >= 1000, true)
      assert.strictEqual(info.total.consumerMessages >= 1000 * 200, true)
      assert.strictEqual(info.total.consumers >= 200, true)
      assert.strictEqual(info.total.rooms >= 200, true)
      assert.strictEqual(info.current[`${stats.serverId}:${config.instancePort}`] >= 200, true)
    })
  })
})
