'use strict'

const fs = require('fs')
const path = require('path')
const debug = require('debug')('snapper:producer')

const redis = require('./redis')
const stats = require('./stats')
const consumersLua = fs.readFileSync(path.resolve(__dirname, '../lua/consumers.lua'), {encoding: 'utf8'})
const redisClient = redis.defaultClient

// Add a consumer to a specified room via rpc.
exports.joinRoom = function * (room, consumerId) {
  let roomKey = redis.genRoomKey(room)
  debug('joinRoom:', room, consumerId)
  let res = yield [
    redisClient.hset(roomKey, consumerId, 1),
    // Stale room will be removed after 172800 sec.
    redisClient.expire(roomKey, redis.DEFT_ROOM_EXP)
  ]

  stats.addRoomsHyperlog(room)
  return res[0]
}

// Remove a consumer from a specified room via rpc.
exports.leaveRoom = function (room, consumerId) {
  debug('leaveRoom:', room, consumerId)
  return redisClient.hdel(redis.genRoomKey(room), consumerId)
}

// For testing purposes.
exports.clearRoom = function (room) {
  return redisClient.del(redis.genRoomKey(room))
}

// Broadcast messages to redis queue
exports.broadcastMessage = function * (room, message) {
  let roomKey = redis.genRoomKey(room)
  let consumers = yield redisClient.evalauto(consumersLua, 1, roomKey)
  if (!consumers || !consumers.length) return

  yield consumers.map((consumerId) => {
    // Ignore errors to deal with others
    let queueKey = redis.genQueueKey(consumerId)
    return redisClient.rpushx(queueKey, message)((_, res) => {
      res = +res
      // Weaken non-exists consumer, it will be removed in next cycle unless it being added again.
      if (!res) return redisClient.hincrby(roomKey, consumerId, -1)
      // if queue's length is too large, means that consumer was offline long time,
      // or some exception messages produced. Anyway, it is no need to cache
      if (res > redis.MAX_MESSAGE_QUEUE_LEN) {
        return redisClient.ltrim(queueKey, 0, redis.MAX_MESSAGE_QUEUE_LEN)
      }
    })
  })

  yield redisClient.publish(redis.CHANNEL, consumers.join(','))
}

exports.getUserConsumers = function (userId) {
  debug('getUserConsumers:', userId)
  return redisClient.smembers(redis.genUserStateKey(userId))
}
