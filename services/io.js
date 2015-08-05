'use strict'

const config = require('config')
const debug = require('debug')('snapper:io')

const redis = require('./redis')
const tools = require('./tools')
const stats = require('./stats')

const redisPrefix = config.redisPrefix
const expires = config.redisQueueExpires
const messageChannel = `${redisPrefix}:message`

redis.clientSub
  .on('message', function (channel, consumerIds) {
    if (channel !== messageChannel) return
    debug('message:', channel, consumerIds)

    consumerIds = consumerIds.split(', ')
    for (var i = 0; i < consumerIds.length; i++) {
      if (consumerIds[i]) exports.pullMessage(consumerIds[i])
    }
  })
  .subscribe(messageChannel)(tools.logErr)

// should replace by ws' clients
exports.consumers = {}

// by ws, add consumer's message queue
exports.addConsumer = function (consumerId) {
  var queueId = genQueueId(consumerId)
  // init messages queue
  debug('addConsumer:', consumerId)
  redis.client.lindex(queueId, 0)(function *(err, res) {
    var initTask = []
    if (err) initTask.push(redis.client.del(queueId))
    if (!res) initTask.push(redis.client.rpush(queueId, '1'))
    if (initTask.length) yield initTask

    yield redis.client.expire(queueId, expires)
    exports.pullMessage(consumerId)
  })(tools.logErr)
}

exports.updateConsumer = function (consumerId) {
  redis.client.expire(genQueueId(consumerId), expires)(tools.logErr)
}

// by ws, weaken consumer's message queue
// 削减消息队列的生存期，如果客户端已失去链接，则消息队列在 5 分钟后被移除
// 若客户端依然保持了链接，则生存期能被还原
exports.weakenConsumer = function (consumerId) {
  debug('weakenConsumer:', consumerId)
  redis.client.expire(genQueueId(consumerId), 300)(tools.logErr)
}

// by rpc, add consumer to room
exports.joinRoom = function (room, consumerId) {
  var roomId = genRoomId(room)
  debug('joinRoom:', room, consumerId)
  return redis.client.sadd(roomId, consumerId)(function *(err, res) {
    if (err) {
      res = (yield [
        redis.client.del(roomId),
        redis.client.sadd(roomId, consumerId)
      ])[1]
    }
    // stale room will be del after 172800 sec
    yield redis.client.expire(roomId, 172800)
    stats.addRoomsHyperlog(room)
    return res
  })
}

// by rpc, remove consumer from room
exports.leaveRoom = function (room, consumerId) {
  debug('leaveRoom:', room, consumerId)

  return redis.client.srem(genRoomId(room), consumerId)
}

// for test
exports.clearRoom = function *(room) {
  debug('clearRoom:', room)
  return yield redis.client.del(genRoomId(room))
}

// by rpc, push messages to redis queue
// exports.pushMessage = function(consumerId, message) {
//   debug('pushMessage:', consumerId, message)
//
//   redis.client.rpushx(genQueueId(consumerId), message)(function(err, res) {
//     if (err !== null) throw err
//     // trigger pullMessage
//     return redis.client.publish(messageChannel, consumerId)
//   })(tools.logErr)
// }

// by rpc, broadcast messages to redis queue
exports.broadcastMessage = function (room, message) {
  debug('broadcastMessage:', room, message)
  redis.client.evalsha(redis.broadcastLuaSHA, 1, genRoomId(room), message)(tools.logErr)
}

// to consumer, auto pull messages from redis queue
exports.pullMessage = function (consumerId) {
  var socket = exports.consumers[consumerId]
  if (!socket || socket.ioPending) return

  socket.ioPending = true
  var queueId = genQueueId(consumerId)
  // 一次批量发送最多 20 条消息，index 0 为占位消息（`'1'` 或上一次的已读消息），空 list 会被自动删除。
  redis.client.lrange(queueId, 1, 20)(function *(err, messages) {
    if (err) throw err
    if (!messages.length) return

    debug('pullMessage:', consumerId, messages)
    yield socket.sendMessages(messages)
    yield redis.client.ltrim(queueId, messages.length, -1)
    stats.incrConsumerMessages(messages.length)

    return true
  })(function (err, res) {
    socket.ioPending = false
    if (err !== null) tools.logErr(err)
    else if (res === true) exports.pullMessage(consumerId)
  })
}

exports.addUserConsumer = function (userId, consumerId) {
  var userKey = genUserStateId(userId)
  debug('addUserConsumer:', userId, consumerId)
  return redis.client.sadd(userKey, consumerId)(function *(err, res) {
    if (err) {
      res = (yield [
        redis.client.del(userKey),
        redis.client.sadd(userKey, consumerId)
      ])[1]
    }
    // stale room will be del after 172800 sec
    yield redis.client.expire(userKey, 172800)
    return res
  })
}

exports.removeUserConsumer = function (userId, consumerId) {
  debug('removeUserConsumer:', userId, consumerId)
  return redis.client.srem(genUserStateId(userId), consumerId)(tools.logErr)
}

exports.getUserConsumers = function (userId) {
  debug('getUserConsumers:', userId)
  return redis.client.smembers(genUserStateId(userId))
}

// List, consumer's message queue key
function genQueueId (consumerId) {
  return `${redisPrefix}:L:${consumerId}`
}

// Set, room's key
function genRoomId (room) {
  return `${redisPrefix}:S:${room}`
}

// Set, room's key
function genUserStateId (userId) {
  return `${redisPrefix}:U:${userId}`
}
