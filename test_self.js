'use strict'

const config = require('config')
config.port += 10000
config.rpcPort += 10000
require('./app')
require('./rpc')

const ilog = require('ilog')
const assert = require('assert')
const thunk = require('thunks')()
const Producer = require('snapper-producer')
const Consumer = require('snapper-consumer')
const redis = require('./lib/service/redis')

thunk.race([
  function * () {
    yield thunk.delay(3000)
    throw new Error('Self test timeout!')
  },
  function * () {
    let time = Date.now()
    // should not shrow error.

    ilog.info('Check Redis...')
    ilog('Redis result:', yield redis.testSelf())

    ilog.info('Check RPC...')
    let producer = new Producer(config.rpcPort, {
      secretKeys: config.tokenSecret[0],
      producerId: 'test-self'
    })
    let res = yield producer.request('echo', ['producer'])
    assert.deepEqual(res, ['producer'])
    ilog('RPC result:', res)

    ilog.info('Check Websocket...')
    let token = producer.signAuth({userId: '000000000000000000000000'})
    let consumer = new Consumer(`127.0.0.1:${config.port}`, {
      path: '/websocket',
      token: token
    })
    consumer.connect()
    res = yield (done) => consumer.request('echo', ['consumer'], done)
    assert.deepEqual(res, ['consumer'])
    ilog('Check Websocket result:', res)

    ilog.info(`Self test success, ${Date.now() - time} ms!`)
  }
])((err) => {
  if (err) ilog(err)
  process.exit(err ? 1 : 0)
})
