'use strict'

const os = require('os')
const config = require('config')

const ilog = require('ilog')
const redis = require('./redis')
const tools = require('../tool')

const network = JSON.stringify(os.networkInterfaces())
  .match(/"address":"[^"]+"/g)
  .map(function (ip) { return ip.slice(11, -1) })

const serverId = tools.md5(JSON.stringify(network))
// Hash
const statsKey = `${redis.PREFIX}:STATS`
// HyperLogLog
const roomKey = `${redis.PREFIX}:STATS:ROOM`
// Hash
const serverKey = `${redis.PREFIX}:STATS:SERVERS`

const redisClient = redis.defaultClient

exports.serverId = serverId

exports.os = function () {
  let res = {
    net: network,
    serverId: serverId,
    mem: {
      free: (os.freemem() / 1024 / 1204).toFixed(2) + ' MB',
      total: (os.totalmem() / 1024 / 1204).toFixed(2) + ' MB'
    }
  }
  return res
}

exports.incrProducerMessages = function (count) {
  redisClient.hincrby(statsKey, 'producerMessages', count)(ilog.error)
}

exports.incrConsumerMessages = function (count) {
  redisClient.hincrby(statsKey, 'consumerMessages', count)(ilog.error)
}

exports.incrConsumers = function (count) {
  redisClient.hincrby(statsKey, 'consumers', count)(ilog.error)
}

exports.addRoomsHyperlog = function (roomId) {
  redisClient.pfadd(roomKey, roomId)(ilog.error)
}

exports.setConsumersStats = function (consumers) {
  redisClient.hset(serverKey, `${serverId}:${config.instancePort}`, consumers)(ilog.error)
}

exports.clientsStats = function * () {
  let res = yield [
    redisClient.pfcount(roomKey),
    redisClient.hgetall(statsKey),
    redisClient.hgetall(serverKey)
  ]
  res[1].rooms = '' + res[0]
  return {
    total: res[1],
    current: res[2]
  }
}
