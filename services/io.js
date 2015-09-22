'use strict'

const config = require('config')
const debug = require('debug')('snapper:io')

const redis = require('./redis')
const tools = require('./tools')
const stats = require('./stats')

const redisPrefix = config.redisPrefix
const expires = config.redisQueueExpires
const messageChannel = `${redisPrefix}:message`

const DEFT_MESSAGE_QUEUE_EXP = 60 * 5
const DEFT_ROOM_EXP = 3600 * 24 * 2
const DEFT_NUM_MESSAGES_TO_PULL = 20

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

// Replace by ws' clients.
exports.consumers = {}

// Add consumer's message queue via ws.
exports.addConsumer = function (consumerId) {
  var queueId = genQueueId(consumerId)
  // Initialize message queue.
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

// Weaken consumer's message queue lifetime via ws.
// Consumer's message queue will be removed in 5 minutes since connection lost.
// Consumer's message queue lifetime will be restored if connection is valid.
exports.weakenConsumer = function (consumerId) {
  debug('weakenConsumer:', consumerId)
  redis.client.expire(genQueueId(consumerId), DEFT_MESSAGE_QUEUE_EXP)(tools.logErr)
}

// Add a consumer to a specified room via rpc.
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
    // Stale room will expire after 172800 seconds.
    yield redis.client.expire(roomId, DEFT_ROOM_EXP)
    stats.addRoomsHyperlog(room)
    return res
  })
}

// Remove a consumer from a specified room via rpc.
exports.leaveRoom = function (room, consumerId) {
  debug('leaveRoom:', room, consumerId)
  return redis.client.srem(genRoomId(room), consumerId)
}

// For testing purposes.
exports.clearRoom = function *(room) {
  debug('clearRoom:', room)
  return yield redis.client.del(genRoomId(room))
}

// TODO: push messages to redis queue via rpc.
/* exports.pushMessage = function(consumerId, message) {
   debug('pushMessage:', consumerId, message)

   redis.client.rpushx(genQueueId(consumerId), message)(function(err, res) {
     if (err !== null) throw err
     // trigger pullMessage
     return redis.client.publish(messageChannel, consumerId)
   })(tools.logErr)
 }
*/

// Broadcast messages to redis queue via rpc.
exports.broadcastMessage = function (room, message) {
  debug('broadcastMessage:', room, message)
  redis.client.evalsha(redis.broadcastLuaSHA, 1, genRoomId(room), message)(tools.logErr)
}

// Automatically pull messages from redis queue to a customer.
exports.pullMessage = function (consumerId) {
  var socket = exports.consumers[consumerId]
  if (!socket || socket.ioPending) return

  socket.ioPending = true
  var queueId = genQueueId(consumerId)
  // Pull at most 20 messages at a time.
  // A placeholder message is at index 0 (`'1'` or last unread message).
  // Empty list will be removed automatically.
  redis.client.lrange(queueId, 1, DEFT_NUM_MESSAGES_TO_PULL)(function *(err, messages) {
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
    // Stale room will be removed after 172800 sec.
    yield redis.client.expire(userKey, DEFT_ROOM_EXP)
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

// Key for consumer's message queue.
function genQueueId (consumerId) {
  return `${redisPrefix}:L:${consumerId}`
}

// Key for a room.
function genRoomId (room) {
  return `${redisPrefix}:S:${room}`
}

// Key for a user's state.
function genUserStateId (userId) {
  return `${redisPrefix}:U:${userId}`
}
