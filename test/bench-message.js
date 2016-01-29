'use strict'
/* global */

const config = require('config')
const thunk = require('thunks')()
const ThunkQueue = require('thunk-queue')
const Producer = require('snapper-producer')

const io = require('../lib/services/producer')
const tools = require('../lib/services/tools')
const Consumer = require('./lib/consumer')

// const host = 'push.teambition.net'
const host = '127.0.0.1:7701'

const producer = new Producer(7700, '127.0.0.1', {
  secretKeys: config.tokenSecret,
  producerId: 'testRPC'
})
const messageCount = 100000
const consumerCount = 10

exports.producer = producer

thunk(function *() {
  var consumers = []
  var messages = []
  while (messages.length < messageCount) {
    messages.push(messages.length)
  }

  while (consumers.length < consumerCount) {
    consumers.push(new Consumer(host, {
      path: '/websocket',
      token: producer.signAuth({userId: Consumer.genUserId()})
    }))
  }

  yield io.clearRoom('benchmark')
  // 注册 consumers 消息处理器
  var thunkQueue = ThunkQueue()
  consumers.forEach(function (consumer, index) {
    var received = 0
    thunkQueue.push(thunk(function (done) {
      consumer.message = function (message) {
        received++
        if (message === null) this.close()
        else if (!index && (received % 10000) === 0) process.stdout.write('.')
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
        producer.joinRoom('benchmark', consumer.consumerId, done)
      }
      consumer.connect()
    })
  })

  // 开始发送消息
  var time = Date.now()
  while (messages.length) {
    producer.sendMessage('benchmark', JSON.stringify(messages.shift()))
    if ((messages.length % 10000) === 0) process.stdout.write('.')
  }
  producer.sendMessage('benchmark', JSON.stringify(null))

  // 等待 consumers 所有消息处理完毕
  yield thunkQueue.end()
  time = (Date.now() - time) / 1000
  var ops = Math.floor(messageCount * consumerCount / time)
  yield io.clearRoom('benchmark')

  console.log(`\n${consumerCount} consumers, ${messageCount * consumerCount} messages, ${time.toFixed(2)} sec, ${ops} messages/sec`)
})(tools.logErr)
