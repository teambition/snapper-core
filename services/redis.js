'use strict'

const fs = require('fs')
const config = require('config')
const redis = require('thunk-redis')
const tools = require('./tools')

const client = redis.createClient(config.redis.port, config.redis.host)
const clientSub = redis.createClient(config.redis.port, config.redis.host)
const consumersLua = stripBOM(fs.readFileSync(process.cwd() + '/lua/consumers.lua', {encoding: 'utf8'}))

client
  .on('connect', function () {
    tools.logInfo('thunk-redis', {
      redisHost: config.redis.port,
      redisPort: config.redis.host,
      message: 'connected'
    })
  })
  .on('error', tools.logErr)
  .on('warn', function (err) {
    tools.logInfo('thunk-redis', err)
  })
  .on('close', function (hadErr) {
    if (hadErr) return tools.logErr(hadErr)
  })

exports.client = client
exports.clientSub = clientSub

var luaSHA = null
exports.getConsumers = function *(roomKey) {
  if (!luaSHA) luaSHA = yield client.script('load', consumersLua)
  return client.evalsha(luaSHA, 1, roomKey)
}

function stripBOM (content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
  return content
}
