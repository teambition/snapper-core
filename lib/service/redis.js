'use strict'

const ilog = require('ilog')
const config = require('config')
const redis = require('thunk-redis')

const PREFIX = exports.PREFIX = config.redisPrefix

exports.EXPIRES = config.redisQueueExpires
exports.CHANNEL = `${PREFIX}:message`
exports.MAX_MESSAGE_QUEUE_LEN = 1024
exports.DEFT_NUM_MESSAGES_TO_PULL = 50
exports.DEFT_ROOM_EXP = 3600 * 24 * 1.5
exports.DEFT_MESSAGE_QUEUE_EXP = 60 * 5

exports.getClient = function (catchClose) {
  let client = redis.createClient(config.redis.hosts, config.redis.options)
    .on('error', (err) => {
      err.class = 'thunk-redis'
      ilog.error(err)
      if (err.code === 'ENETUNREACH') throw err
    })

  if (catchClose) {
    client.on('close', () => {
      let err = new Error('Redis client closed!')
      err.class = 'thunk-redis'
      ilog.error(err)
      throw err
    })
  }
  return client
}

// Key for consumer's message queue. It is a List
exports.genQueueKey = function (consumerId) {
  return `${PREFIX}:L:${consumerId}`
}

// Key for a room. It is a Hash
exports.genRoomKey = function (room) {
  return `${PREFIX}:H:${room}`
}

// Key for a user's state. It is a Set
exports.genUserStateKey = function (userId) {
  return `${PREFIX}:U:${userId}`
}

exports.defaultClient = exports.getClient(true)
