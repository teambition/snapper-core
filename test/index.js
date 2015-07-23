'use strict'
/*global describe, it, before, after*/

const config = require('config')
const assert = require('assert')
const thunk = require('thunks')()
const request = require('supertest')
const ThunkQueue = require('thunk-queue')
const Producer = require('snapper2-producer')

const app = require('../app')
const redis = require('../services/redis')
const stats = require('../services/stats')
const Consumer = require('./lib/consumer')

var producerId = 0

describe('snapper2', function () {
  before(function (callback) {
    redis.client.flushall()(callback)
  })

  after(function (callback) {
    thunk(function *() {
      yield redis.client.flushall()
      yield thunk.delay(1000)
      process.emit('message', 'shutdown')
    })(callback)
  })

  describe('rpc', function () {
    it('connect:Unauthorized', function (callback) {
      var producer = new Producer(config.rpcPort, {
        secretKeys: 'xxx',
        producerId: ++producerId + ''
      })

      producer
        .on('connect', function () {
          assert.strictEqual('Should not run', true)
        })
        .on('error', function (err) {
          assert.strictEqual(err.code, 400)
        })
        .on('close', callback)
    })

    it('connect:success', function (callback) {
      var producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })

      producer
        .on('connect', function () {
          this.close()
        })
        .on('error', function () {
          assert.strictEqual('Should not run', true)
        })
        .on('close', callback)
    })

    it('signAuth', function (callback) {
      var producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })

      var token = producer.signAuth({test: true})
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

    it('sendMessage', function (callback) {
      var producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })

      assert.throws(function () {
        producer.sendMessage('room', 123)
      })
      assert.throws(function () {
        producer.sendMessage(123, 123)
      })
      assert.throws(function () {
        producer.sendMessage('room', '')
      })

      var count = 0
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

    it('joinRoom, leaveRoom', function (callback) {
      var producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })

      assert.throws(function () {
        producer.joinRoom('room', 123)
      })
      assert.throws(function () {
        producer.joinRoom(123, 123)
      })
      assert.throws(function () {
        producer.leaveRoom('room', '')
      })

      producer
        .on('error', callback)
        .on('close', callback)

      producer.joinRoom = thunk.thunkify(producer.joinRoom)
      producer.leaveRoom = thunk.thunkify(producer.leaveRoom)

      thunk(function *() {
        var res = yield producer.joinRoom('test', '1')
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

    it('reconnecting', function (callback) {
      var producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })
      var reconnecting = false

      producer
        .on('error', function (err) {
          assert.strictEqual(err instanceof Error, true)
        })
        .on('connect', function () {
          if (reconnecting) {
            producer.close()
            callback()
          } else app.context.rpc.destroy()
        })
        .on('reconnecting', function () {
          reconnecting = true
          app.connectRPC()
        })
    })

    it('close', function (callback) {
      var producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })
      var hadError = false

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

  describe('ws', function () {
    var producer = null
    var host = '127.0.0.1:' + config.port

    before(function (callback) {
      producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: ++producerId + ''
      })
      producer
        .on('error', callback)
        .on('connect', callback)
    })

    after(function (callback) {
      producer.close()
      callback()
    })

    it('connect:Unauthorized', function (callback) {
      var consumer = new Consumer(host, {
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

    it('connect:success', function (callback) {
      var token = producer.signAuth({userId: Consumer.genUserId()})
      var consumer = new Consumer(host, {
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

    it('receive message in order', function (callback) {
      var userId = Consumer.genUserId()
      var token = producer.signAuth({userId: userId})
      var consumer = new Consumer(host, {
        path: '/websocket',
        token: token
      })
      var res = []

      consumer.onopen = function () {
        var room = `user${userId}`
        producer
          .sendMessage(room, JSON.stringify(1))
          .sendMessage(room, JSON.stringify(2))
          .sendMessage(room, JSON.stringify(3))
          .sendMessage(room, JSON.stringify(4))
          .sendMessage(room, JSON.stringify(5))
          .sendMessage(room, JSON.stringify('end'))
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

    it('join room and receive message', function (callback) {
      var userId = Consumer.genUserId()
      var token = producer.signAuth({userId: userId})
      var consumer = new Consumer(host, {
        path: '/websocket',
        token: token
      })
      var res = []

      consumer.onopen = function () {
        producer
          .joinRoom('test', consumer.consumerId)
          .sendMessage('test', JSON.stringify({
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

    it('reconnect and receive message', function (callback) {
      var userId = Consumer.genUserId()
      var token = producer.signAuth({userId: userId})
      var consumer = new Consumer(host, {
        path: '/websocket',
        token: token
      })
      var res = []

      consumer.onopen = function () {
        producer
          .joinRoom('test', consumer.consumerId)
          .sendMessage('test', JSON.stringify(1))
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

          var consumer = new Consumer(host, {
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

  describe('stats && chaos', function () {
    var producer = null
    var host = '127.0.0.1:' + config.port

    before(function (callback) {
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

    it('2000 messages with server restart', function (callback) {
      var received = []
      var messages = []
      while (messages.length < 2000) messages.push(messages.length)

      var userId = Consumer.genUserId()
      var consumer = new Consumer(host, {
        path: '/websocket',
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

      thunk(function *() {
        var _messages = messages.slice()
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
        app.context.rpc.destroy()
        thunk.delay(1000)(function () {
          app.connectRPC()
        })
      }

    })

    it('100000 messages to 20 consumers', function (callback) {
      var consumers = []
      var messages = []
      while (messages.length < 100000) messages.push(messages.length)
      while (consumers.length < 20) {
        consumers.push(new Consumer(host, {
          path: '/websocket',
          token: producer.signAuth({userId: Consumer.genUserId()})
        }))
      }

      thunk(function *() {
        // 注册 consumers 消息处理器
        var thunkQueue = ThunkQueue()
        consumers.forEach(function (consumer, index) {
          var received = []
          thunkQueue.push(thunk(function (done) {
            consumer.message = function (message) {
              if (message === null) {
                assert.deepEqual(received, messages)
                this.close()
              } else {
                received.push(message)
                if (!index && (received.length % 10000) === 0) process.stdout.write('.')
              }
            }
            consumer.onerror = function (err) {
              console.error(err)
              done(err)
            }
            consumer.onclose = done
          }))
        })

        // 等待 consumers 连接并加入 chaos room
        yield consumers.map(function (consumer) {
          return thunk(function (done) {
            consumer.onopen = function () {
              producer.joinRoom('chaos', consumer.consumerId, done)
            }
            consumer.connect()
          })
        })

        // 开始发送消息
        var _messages = messages.slice()
        while (_messages.length) {
          let random = Math.ceil(Math.random() * 100)
          // 等待 random 毫秒
          yield thunk.delay(random)
          // 并发发送 10 * random  条消息
          let todo = _messages.splice(0, random * 10)
          // console.log('send:', todo.length, 'left:', _messages.length)
          while (todo.length) producer.sendMessage('chaos', JSON.stringify(todo.shift()))
          process.stdout.write('.')
        }
        producer.sendMessage('chaos', JSON.stringify(null))

        // 等待 consumers 所有消息处理完毕
        yield thunkQueue.end()

        // get stats
        var req = request(app.server)
          .get(`/stats?token=${producer.signAuth({name: 'snapper'})}`)
          .expect(function (res) {
            var info = res.body.stats
            assert.strictEqual(info.total.producerMessages >= 100000, true)
            assert.strictEqual(info.total.consumerMessages >= 100000 * 20, true)
            assert.strictEqual(info.total.consumers >= 20, true)
            assert.strictEqual(info.total.rooms >= 20, true)

            assert.strictEqual(info.current[`${stats.serverId}:${config.instancePort}`] >= 20, true)
          })

        yield req.end.bind(req)
      })(callback)
    })
  })

})
