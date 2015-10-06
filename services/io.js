'use strict'

const config = require('config')
const thunk = require('thunks')()
const debug = require('debug')('snapper:io')

const redis = require('./redis')
const tools = require('./tools')
const stats = require('./stats')
const thunkE = require('thunks')(tools.logErr) // catch all errors

const redisPrefix = config.redisPrefix
const expires = config.redisQueueExpires
const messageChannel = `${redisPrefix}:message`

const DEFT_ROOM_EXP = 3600 * 24 * 2
const DEFT_NUM_MESSAGES_TO_PULL = 20
const DEFT_MESSAGE_QUEUE_EXP = 60 * 5

redis.clientSub
  .on('message', function (channel, consumerIds) {
    if (channel !== messageChannel) return
    debug('message:', channel, consumerIds)

    consumerIds = consumerIds.split(',')
    for (var i = 0; i < consumerIds.length; i++) pullMessage(consumerIds[i])
  })
  .subscribe(messageChannel)(tools.logErr)

// Replace by ws' clients.
exports.consumers = {}

// Add consumer's message queue via ws.
exports.addConsumer = function (consumerId) {
  var queueKey = genQueueKey(consumerId)
  // Initialize message queue.
  debug('addConsumer:', consumerId)
  redis.client.lindex(queueKey, 0)(function *(err, res) {
    if (err) throw err

    var tasks = []
    if (!res) tasks.push(redis.client.rpush(queueKey, '1'))
    tasks.push(redis.client.expire(queueKey, expires))
    yield tasks

    pullMessage(consumerId)
  })(tools.logErr)
}

exports.updateConsumer = function (consumerId) {
  redis.client.expire(genQueueKey(consumerId), expires)(tools.logErr)
}

// Weaken consumer's message queue lifetime via ws.
// Consumer's message queue will be removed in 5 minutes since connection lost.
// Consumer's message queue lifetime will be restored if connection is valid.
exports.weakenConsumer = function (consumerId) {
  debug('weakenConsumer:', consumerId)
  redis.client.expire(genQueueKey(consumerId), DEFT_MESSAGE_QUEUE_EXP)(tools.logErr)
}

// Add a consumer to a specified room via rpc.
exports.joinRoom = function (room, consumerId) {
  var roomKey = genRoomKey(room)
  debug('joinRoom:', room, consumerId)
  return thunk.all([
    redis.client.hset(roomKey, consumerId, 1),
    // Stale room will be removed after 172800 sec.
    redis.client.expire(roomKey, DEFT_ROOM_EXP)
  ])(function *(err, res) {
    if (err) throw err
    stats.addRoomsHyperlog(room)
    return res[0]
  })
}

// Remove a consumer from a specified room via rpc.
exports.leaveRoom = function (room, consumerId) {
  debug('leaveRoom:', room, consumerId)
  return redis.client.hdel(genRoomKey(room), consumerId)
}

// For testing purposes.
exports.clearRoom = function (room) {
  return redis.client.del(genRoomKey(room))
}

// Broadcast messages to redis queue
exports.broadcastMessage = function (room, message) {
  debug('broadcastMessage:', room, message)
  thunkE(function *() {
    var roomKey = genRoomKey(room)
    var consumers = yield redis.getConsumers(roomKey)
    var otherConsumers = []
    if (!consumers || !consumers.length) return

    yield consumers.map(function (consumerId) {
      // Ignore errors to deal with others
      return redis.client.rpushx(genQueueKey(consumerId), message)(function (_, res) {
        // Weaken non-exists consumer, it will be removed in next cycle unless it being added again.
        if (!+res) return redis.client.hincrby(roomKey, consumerId, -1)
        if (res) {
          if (exports.consumers[consumerId]) pullMessage(consumerId)
          else otherConsumers.push(consumerId)
        }
      })(tools.logErr)
    })

    if (otherConsumers.length) {
      yield redis.client.publish(messageChannel, otherConsumers.join(','))
    }
  })()
}

exports.addUserConsumer = function (userId, consumerId) {
  var userKey = genUserStateKey(userId)
  debug('addUserConsumer:', userId, consumerId)
  thunkE.all([
    redis.client.sadd(userKey, consumerId),
    // Stale room will be removed after 172800 sec.
    redis.client.expire(userKey, DEFT_ROOM_EXP)
  ])()
}

exports.removeUserConsumer = function (userId, consumerId) {
  debug('removeUserConsumer:', userId, consumerId)
  return redis.client.srem(genUserStateKey(userId), consumerId)(tools.logErr)
}

exports.getUserConsumers = function (userId) {
  debug('getUserConsumers:', userId)
  return redis.client.smembers(genUserStateKey(userId))
}

// Automatically pull messages from redis queue to a customer.
function pullMessage (consumerId) {
  var socket = exports.consumers[consumerId]
  if (!socket || socket.ioPending) return

  socket.ioPending = true
  var queueKey = genQueueKey(consumerId)
  // Pull at most 20 messages at a time.
  // A placeholder message is at index 0 (`'1'` or last unread message).
  // Because empty list will be removed automatically.
  redis.client.lrange(queueKey, 1, DEFT_NUM_MESSAGES_TO_PULL)(function *(err, messages) {
    if (err) throw err
    if (!messages.length) return

    debug('pullMessage:', consumerId, messages)
    yield socket.sendMessages(messages)
    // messages have been send to consumer, remove them from queue.
    yield redis.client.ltrim(queueKey, messages.length, -1)
    stats.incrConsumerMessages(messages.length)

    return true
  })(function (err, res) {
    socket.ioPending = false
    if (err !== null) tools.logErr(err)
    else if (res === true) pullMessage(consumerId)
  })
}

// Key for consumer's message queue. It is a List
function genQueueKey (consumerId) {
  return `${redisPrefix}:L:${consumerId}`
}

// Key for a room. It is a Hash
function genRoomKey (room) {
  return `${redisPrefix}:H:${room}`
}

// Key for a user's state. It is a Set
function genUserStateKey (userId) {
  return `${redisPrefix}:U:${userId}`
}
