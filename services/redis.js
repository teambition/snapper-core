'use strict'

const ilog = require('ilog')
const config = require('config')
const redis = require('thunk-redis')

const PREFIX = exports.PREFIX = config.redisPrefix

exports.EXPIRES = config.redisQueueExpires
exports.CHANNEL = `${PREFIX}:message`
exports.DEFT_ROOM_EXP = 3600 * 24 * 2
exports.DEFT_NUM_MESSAGES_TO_PULL = 50
exports.DEFT_MESSAGE_QUEUE_EXP = 60 * 5
exports.MAX_MESSAGE_QUEUE_LEN = 1024 * 2

var clientIndex = 0
exports.getClient = function () {
  return redis.createClient(config.redis.hosts, config.redis.options)
    .on('connect', function () {
      ilog.info({
        redisHost: config.redis.port,
        redisPort: config.redis.host,
        message: 'thunk-redis connected',
        index: ++clientIndex
      })
    })
    .on('error', function (error) {
      ilog.emergency(error)
      // the application should restart if error occured
      throw error
    })
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

exports.defaultClient = exports.getClient()
