'use strict'
/*global describe, it, before, after, beforeEach*/

// TODO some issue with script on redis cluster

const config = require('config')
const assert = require('assert')
const thunk = require('thunks')()
const ThunkQueue = require('thunk-queue')
const Producer = require('snapper-producer')

config.redis.hosts = [7000, 7001, 7002]

require('../app')
const redis = require('../services/redis')
const Consumer = require('./lib/consumer')

var producerId = 0

describe('snapper on redis-cluster', function () {
  var producer = null
  var host = '127.0.0.1:' + config.port

  before(function *() {
    yield redis.client.flushall()
  })

  after(function *() {
    yield redis.client.flushall()
    yield thunk.delay(1000)
    process.emit('message', 'shutdown')
  })

  beforeEach(function (callback) {
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

  it('100000 messages to 20 consumers', function *() {
    var consumers = []
    var messages = []
    while (messages.length < 100000) messages.push(messages.length)
    while (consumers.length < 20) {
      consumers.push(new Consumer(host, {
        path: '/websocket',
        token: producer.signAuth({userId: Consumer.genUserId()})
      }))
    }

    // 注册 consumers 消息处理器
    var thunkQueue = ThunkQueue()
    consumers.forEach(function (consumer, index) {
      var received = []
      thunkQueue.push(thunk(function (done) {
        consumer.message = function (message) {
          if (message === null) {
            assert.deepEqual(received, messages)
            done()
          } else {
            received.push(message)
            if (!index && (received.length % 10000) === 0) process.stdout.write('.')
          }
        }
        consumer.onerror = function (err) {
          console.error(err)
          done(err)
        }
        // consumer.onclose = done
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
  })
})
