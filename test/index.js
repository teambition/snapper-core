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
const host = '127.0.0.1:' + config.port

var roomId = 0
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
    tman.it('connect:Unauthorized', function * () {
      let producer = new Producer(config.rpcPort, {
        secretKeys: 'xxx',
        producerId: ++producerId + ''
      })

      let error = null
      producer
        .on('connect', () => {
          assert.strictEqual('Should not run', true)
        })
        .on('error', (err) => {
          error = err
        })

      yield (done) => producer.on('close', done)
      assert.strictEqual(error.code, 401)
    })

    tman.it('connect:success', function * () {
      let producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })

      producer.on('error', (err) => {
        assert.strictEqual('Should not run', err)
      })
      yield (done) => producer.on('connect', done)
      producer.close()
    })

    tman.it('signAuth', function * () {
      let producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })

      let token = producer.signAuth({test: true})
      assert.strictEqual(app.verifyToken(token).test, true)

      producer.on('error', (err) => {
        assert.strictEqual('Should not run', err)
      })
      yield (done) => producer.on('connect', done)
      producer.close()
    })

    tman.it('sendMessage', function * () {
      let producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })

      let room = `test_room${roomId++}`
      let userId = Consumer.genUserId()
      let token = producer.signAuth({userId: userId})
      let consumer = new Consumer(host, {
        path: '/websocket',
        token: token
      })

      let res = []
      consumer.message = function (message) {
        res.push(message)
        if (res.length === 3) consumer.close()
      }
      consumer.connect()
      yield (done) => {
        consumer.onopen = done
      }
      yield producer.joinRoom(room, consumer.consumerId)

      producer
        .sendMessage(room, '1')
        .sendMessage(room, '2')
        .sendMessage(room, '3')

      yield (done) => {
        consumer.onclose = done
      }
      producer.close()
      assert.deepEqual(res, [1, 2, 3])
    })

    tman.it('joinRoom, leaveRoom', function * () {
      let producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })
      let room = `test_room${roomId++}`

      yield producer.joinRoom(room, 123)((err) => {
        assert.strictEqual(err instanceof Error, true)
      })

      yield producer.joinRoom(123, 123)((err) => {
        assert.strictEqual(err instanceof Error, true)
      })

      yield producer.joinRoom(room, '')((err) => {
        assert.strictEqual(err instanceof Error, true)
      })

      let res = yield producer.joinRoom(room, '1')
      assert.strictEqual(res, 1)

      res = yield producer.joinRoom(room, '2')
      assert.strictEqual(res, 1)

      res = yield producer.leaveRoom(room, '1')
      assert.strictEqual(res, 1)

      producer.close()
    })

    tman.it('request', function * () {
      let producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })

      yield producer.request('get', 123)((err) => {
        assert.strictEqual(err instanceof Error, true)
        assert.strictEqual(err.message, 'Invalid params')
      })

      yield producer.request('get', [])((err) => {
        assert.strictEqual(err instanceof Error, true)
        assert.strictEqual(err.message, 'Method not found')
      })

      yield producer.request('consumers', [])((err) => {
        assert.strictEqual(err instanceof Error, true)
        assert.strictEqual(err.message, 'Invalid params')
      })

      let res = yield producer.request('consumers', ['userIdxxx'])
      assert.deepEqual(res, {length: 0, android: 0, web: 0, ios: 0})

      let userId = Consumer.genUserId()
      let token = producer.signAuth({userId: userId})
      let consumer = new Consumer(host, {
        path: '/websocket',
        token: token
      })
      consumer.onerror = () => {
        assert.strictEqual('Should not run', true)
      }
      consumer.connect()
      yield (done) => {
        consumer.onopen = done
      }
      res = yield producer.request('consumers', [userId])
      assert.deepEqual(res, {length: 1, android: 0, ios: 0, web: 1})
      consumer.close()
      producer.close()
    })

    tman.it('reconnecting', function (callback) {
      let producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })
      let reconnecting = false
      producer
        .on('connect', () => {
          if (reconnecting) producer.close()
          else rpc.close(() => rpc.listen(config.rpcPort))
        })
        .on('reconnecting', () => {
          reconnecting = true
        })
        .on('close', () => {
          assert.strictEqual(reconnecting, true)
          callback()
        })
    })

    tman.it('close', function (callback) {
      let producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })
      producer
        .on('close', () => {
          callback()
        })
        .on('connect', () => {
          producer.sendMessage('test', '12345')
          producer.close()
        })
    })
  })

  tman.suite('ws', function () {
    let producer = null

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
      id = tool.session2ID({
        exp: 1467429475,
        userId: '55a07f2dee06c78e1357b0ad',
        source: 'teambition'
      })
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

      function * addConsumer (id) {
        // delay 1秒防止生成的 consumerId 冲突
        yield thunk.delay(1100)
        let token = producer.signAuth({userId: userId, id: id})
        let consumer = new Consumer(host, {
          path: '/websocket',
          token: token
        })
        consumer.onerror = function () {
          assert.strictEqual('Should not run', true)
        }
        consumer.connect()
        yield (done) => {
          consumer.onopen = done
        }
        return consumer
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
  })

  tman.suite('stats && chaos', function () {
    this.timeout(20000)

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

    tman.it('1000 messages with server restart', function * () {
      let received = []
      let messages = []
      while (messages.length < 1000) messages.push(messages.length)

      let userId = Consumer.genUserId()
      let consumer = new Consumer(host, {
        path: '/websocket',
        transports: ['websocket'], // easy to trigger "xhr poll error"
        token: producer.signAuth({userId: userId})
      })
      consumer.message = function (message) {
        if (message === null) {
          // One or two messages maybe losed when server restart because of `notification`
          assert.strictEqual(received.length <= messages.length, true)
          assert.strictEqual(messages.length - received.length <= 2, true)
          this.close()
        } else received.push(message)
      }
      consumer.connect()
      yield (done) => {
        consumer.onopen = done
      }

      // wait for consumer join user room!
      yield thunk.delay(500)
      let _messages = messages.slice()
      while (_messages.length) {
        if (_messages.length === 500) {
          rpc.close()
          yield thunk.delay(1000)
          rpc.listen(config.rpcPort)
        }
        let random = Math.ceil(Math.random() * 10)
        // 等待 random 毫秒
        yield thunk.delay(random)
        producer.sendMessage(`user${userId}`, JSON.stringify(_messages.shift()))
        if (_messages.length % 100 === 0) process.stdout.write('.')
      }
      producer.sendMessage(`user${userId}`, JSON.stringify(null))

      yield (done) => {
        consumer.onclose = done
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
            producer.joinRoom('chaos', consumer.consumerId)(done)
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
