'use strict'

const ilog = require('ilog')
const thunk = require('thunks')()
const debug = require('debug')('snapper:io')

const redis = require('./redis')
const stats = require('./stats')

const redisClient = redis.defaultClient
const messagesClient = redis.getClient(true)
const subscribeClient = redis.getClient(true)

subscribeClient
  .on('message', (channel, consumerIds) => {
    if (channel !== redis.CHANNEL) return
    debug('message:', channel, consumerIds)

    consumerIds = consumerIds.split(',')
    consumerIds.map(pullMessage)
  })
  .subscribe(redis.CHANNEL)((error) => {
    if (error) {
      ilog.emergency(error)
      // the application should restart if error occured
      throw error
    }
  })

// Replace by ws' clients.
exports.consumers = {}

// Add consumer's message queue via ws.
exports.addConsumer = function * (consumerId) {
  let queueKey = redis.genQueueKey(consumerId)
  // Initialize message queue.
  debug('addConsumer:', consumerId)
  let res = yield redisClient.lindex(queueKey, 0)
  let tasks = []
  if (!res) tasks.push(redisClient.rpush(queueKey, '1'))
  tasks.push(redisClient.expire(queueKey, redis.EXPIRES))
  yield tasks
}

exports.updateConsumer = function (userId, consumerId) {
  thunk.all(
    exports.addUserConsumer(userId, consumerId),
    redisClient.expire(redis.genQueueKey(consumerId), redis.EXPIRES)
  )(ilog.error)
}

// Weaken consumer's message queue lifetime via ws.
// Consumer's message queue will be removed in 5 minutes since connection lost.
// Consumer's message queue lifetime will be restored if connection is valid.
exports.weakenConsumer = function (consumerId) {
  redisClient.expire(redis.genQueueKey(consumerId), redis.DEFT_MESSAGE_QUEUE_EXP)(ilog.error)
}

exports.addUserConsumer = function * (userId, consumerId) {
  let userKey = redis.genUserStateKey(userId)
  debug('addUserConsumer:', userId, consumerId)
  yield [
    redisClient.sadd(userKey, consumerId),
    // Stale room will be removed after 172800 sec.
    redisClient.expire(userKey, redis.DEFT_ROOM_EXP)
  ]

  // clean stale consumerId
  checkUserConsumers(userId, consumerId)
}

exports.removeUserConsumer = function (userId, consumerId) {
  debug('removeUserConsumer:', userId, consumerId)
  return redisClient.srem(redis.genUserStateKey(userId), consumerId)(ilog.error)
}

// Automatically pull messages from redis queue to a customer.
exports.pullMessage = pullMessage
function pullMessage (consumerId) {
  let socket = exports.consumers[consumerId]
  if (!socket || socket.ioPending) return

  socket.ioPending = true
  let queueKey = redis.genQueueKey(consumerId)
  // Pull at most 20 messages at a time.
  // A placeholder message is at index 0 (`'1'` or last unread message).
  // Because empty list will be removed automatically.
  messagesClient.lrange(queueKey, 1, redis.DEFT_NUM_MESSAGES_TO_PULL)(function * (err, messages) {
    if (err) throw err
    if (!messages.length) return

    debug('pullMessage:', consumerId, messages)
    yield socket.sendMessages(messages)
    // messages have been send to consumer, remove them from queue.
    yield messagesClient.ltrim(queueKey, messages.length, -1)
    stats.incrConsumerMessages(messages.length)

    return true
  })((err, res) => {
    socket.ioPending = false
    if (err !== null) ilog.debug(err) // this error isn't necessary to care
    else if (res === true) pullMessage(consumerId)
  })
}

function checkUserConsumers (userId, consumerId) {
  redisClient.smembers(redis.genUserStateKey(userId))(function * (error, consumers) {
    if (error) throw error
    for (let consumer of consumers) {
      if (consumerId === consumer) continue
      let count = yield redisClient.llen(redis.genQueueKey(consumer))
      // count is 0 means consumer not exists.
      // count is great than 1 means consumer is not online, so some messages are not consumed.
      // but sometimes mistake, such as messages are not consumed in time.
      // we rescue it in updateConsumer(socket heartbeat).
      if (count !== 1) exports.removeUserConsumer(userId, consumer)
    }
  })(ilog.error)
}
