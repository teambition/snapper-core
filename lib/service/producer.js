'use strict'

const fs = require('fs')
const path = require('path')
const debug = require('debug')('snapper:producer')

const redis = require('./redis')
const stats = require('./stats')
const tool = require('../tool')
const consumersLua = fs.readFileSync(path.resolve(__dirname, '../lua/consumers.lua'), {encoding: 'utf8'})

class Producer {
  constructor (redisClient) {
    this.client = redisClient || redis.getClient()
  }

  // Add a consumer to a specified room via rpc.
  * joinRoom (room, consumerId) {
    let roomKey = redis.genRoomKey(room)
    debug('joinRoom:', room, consumerId)
    let res = yield [
      this.client.hset(roomKey, consumerId, 1),
      // Stale room will be removed after 172800 sec.
      this.client.expire(roomKey, redis.DEFT_ROOM_EXP)
    ]

    stats.addRoomsHyperlog(room)
    return res[0]
  }

  // Remove a consumer from a specified room via rpc.
  leaveRoom (room, consumerId) {
    debug('leaveRoom:', room, consumerId)
    return this.client.hdel(redis.genRoomKey(room), consumerId)
  }

  // For testing purposes.
  clearRoom (room) {
    return this.client.del(redis.genRoomKey(room))
  }

  // Broadcast messages to redis queue
  * broadcastMessage (room, message) {
    let roomKey = redis.genRoomKey(room)
    let consumers = yield this.client.evalauto(consumersLua, 1, roomKey)
    if (!consumers || !consumers.length) return

    yield consumers.map((consumerId) => {
      // Ignore errors to deal with others
      let queueKey = redis.genQueueKey(consumerId)
      return this.client.rpushx(queueKey, message)((_, res) => {
        res = +res
        // Weaken non-exists consumer, it will be removed in next cycle unless it being added again.
        if (!res) return this.client.hincrby(roomKey, consumerId, -1)
        // if queue's length is too large, means that consumer was offline long time,
        // or some exception messages produced. Anyway, it is no need to cache
        if (res > redis.MAX_MESSAGE_QUEUE_LEN) {
          return this.client.ltrim(queueKey, 0, redis.MAX_MESSAGE_QUEUE_LEN)
        }
      })
    })

    yield this.client.publish(redis.CHANNEL, consumers.join(','))
  }

  * getUserConsumers (userId) {
    let consumerIds = yield this.client.smembers(redis.genUserStateKey(userId))
    let res = {
      length: consumerIds.length,
      android: 0,
      ios: 0,
      // wp: 0,
      web: 0
    }
    consumerIds.forEach((id) => {
      let source = tool.id2source(id)
      res[source]++
    })
    return res
  }

  destroy () {
    this.client.clientEnd()
  }
}

module.exports = Producer
