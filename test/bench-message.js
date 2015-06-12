'use strict'
/*global*/

const config = require('config')
const Thunk = require('thunks')()
const ThunkQueue = require('thunk-queue')
const Producer = require('snapper2-producer')

const io = require('../services/io')
const tools = require('../services/tools')
const Consumer = require('./lib/consumer')

const host = 'push.teambition.net'
// const host = '127.0.0.1'

const producer = new Producer(config.rpcPort, host, {
  secretKeys: config.tokenSecret,
  producerId: 'testRPC'
})
const messageCount = 100000
const consumerCount = 10

exports.producer = producer

Thunk(function *() {
  var consumers = []
  var messages = []
  while (messages.length < messageCount) {
    messages.push(messages.length)
  }

  while (consumers.length < consumerCount) {
    consumers.push(new Consumer(`http://${host}`, producer.signAuth({userId: Consumer.genUserId()})))
  }

  yield io.clearRoom('benchmark')
  // 注册 consumers 消息处理器
  var thunkQueue = ThunkQueue()
  consumers.forEach(function (consumer, index) {
    var received = 0
    thunkQueue.push(Thunk(function (done) {
      consumer
        .on('message', function (message) {
          received++
          if (message === null) this.disconnect()
          else if (!index && (received % 10000) === 0) process.stdout.write('.')
        })
        .on('error', function (err) {
          console.error(err)
          done(err)
        })
        .on('close', done)
    }))
  })

  // 等待 consumers 连接并加入 chaos room
  yield consumers.map(function (consumer) {
    return Thunk(function (done) {
      consumer.on('open', function () {
        producer.joinRoom('benchmark', consumer.id, done)
      })
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
