'use strict';

const fs = require('fs');
const config = require('config');
const redis = require('thunk-redis');
const debug = require('debug')('snapper');

const tools = require('./tools');

const client = redis.createClient(config.redis.port, config.redis.host);
const clientSub = redis.createClient(config.redis.port, config.redis.host);
const broadcastLua = stripBOM(fs.readFileSync('lua/broadcast.lua', {encoding: 'utf8'}))
  .replace(/REDIS_PREFIX/g, config.redisPrefix);

client.script('load', broadcastLua)(function(err, res) {
  if (err) throw err;
  debug('redis add lua:', res);
  exports.broadcastLuaSHA = res;
});

client
  .on('connect', function() {
    tools.logInfo('thunk-redis', {
      redisHost: config.redis.port,
      redisPort: config.redis.host,
      message: 'connected'
    });
  })
  .on('error', tools.logErr)
  .on('warn', function(err) {
    tools.logInfo('thunk-redis', err);
  })
  .on('close', function(hadErr) {
    if (hadErr) return tools.logErr(hadErr);
  });

exports.client = client;
exports.clientSub = clientSub;

function stripBOM(content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  return content;
}
