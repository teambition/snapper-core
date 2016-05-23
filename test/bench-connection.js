'use strict'
/* global */

const config = require('config')
const thunk = require('thunks')()
const Producer = require('snapper-producer')

const Consumer = require('./lib/consumer')

const clients = Object.create(null)
const host = '127.0.0.1:7701'

const producer = new Producer(7700, '127.0.0.1', {
  secretKeys: config.tokenSecret,
  producerId: 'testRPC'
})

exports.clients = clients
exports.producer = producer

exports.add = function (n) {
  n = n > 0 ? +n : 1

  thunk(function * () {
    while (n--) {
      let consumerId = yield addClient()
      yield addToRoom(consumerId)
    }
    console.log('added!')
  })(function (err) {
    if (err) console.error(err)
  })
}

exports.clear = function () {
  for (let key in clients) clients[key].close()
}

function addToRoom (consumerId) {
  return function (callback) {
    producer.joinRoom('benchmark', consumerId, callback)
  }
}

var addCount = 0
var delCount = 0
function addClient () {
  return function (callback) {
    var token = producer.signAuth({userId: Consumer.genUserId()})
    var client = new Consumer(host, {
      path: '/websocket',
      token: token
    })

    client.onopen = function () {
      console.log('connected:', addCount++, this.consumerId)
      clients[this.consumerId] = client
      callback(null, this.consumerId)
    }
    client.onclose = function () {
      console.log('close:', delCount++, client.consumerId)
      delete clients[client.consumerId]
    }
    client.connect()
      .connection.once('close', function () {
        client.close()
      })
  }
}
