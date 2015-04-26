'use strict';

const fs = require('fs');
const config = require('config');
const redis = require('thunk-redis');

const msg = require('./msg');
const tools = require('./tools');

const redisPrefix = config.redisPrefix;
const expires = config.redisQueueExpires;

const client = redis.createClient(config.redis.port, config.redis.host);
const clientSub = redis.createClient(config.redis.port, config.redis.host);
const broadcastLua = stripBOM(fs.readFileSync('lua/broadcast.lua', {encoding: 'utf8'}))
  .replace('REDIS_PREFIX', redisPrefix);

var broadcastLuaSHA = null;
client.script('load', broadcastLua)(function(err, res) {
  if (err) throw err;
  broadcastLuaSHA = res;
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

clientSub
  .on('message', function(consumerId) {
    exports.pullMessage(consumerId);
  })
  .subscribe(`${redisPrefix}:message`)(tools.logErr);

// should replace by ws' clients
exports.consumers = {};

// by ws, add consumer's message queue
exports.addConsumer = function(consumerId) {
  var msg = 'Hi';
  var queueId = genQueueId(consumerId);
  client.rpush(queueId, msg)(function*(err) {
    if (err) {
      yield [
        client.del(queueId),
        client.rpush(queueId, msg)
      ];
    }

    yield client.expire(queueId, expires);
    exports.pullMessage(consumerId);
  });
};

exports.updateConsumer = function(consumerId) {
  client.expire(genQueueId(consumerId), expires)(tools.logErr);
};

// by ws, clear consumer's message queue
exports.removeConsumer = function(consumerId) {
  client.del(genQueueId(consumerId))(tools.logErr);
};

// by rpc, add consumer to room
exports.joinRoom = function(room, consumerId) {
  var roomId = genRoomId(room);
  client.sadd(roomId, consumerId)(function*(err) {
    if (err) {
      yield [
        client.del(roomId),
        client.sadd(roomId, consumerId)
      ];
    }
    // stale room will be del after 172800 sec
    yield client.expire(roomId, 172800);
  });
};

// by rpc, remove consumer from room
exports.leaveRoom = function(room, consumerId) {
  client.srem(genRoomId(room), consumerId)(tools.logErr);
};

// by rpc, push messages to redis queue
exports.pushMessage = function(consumerId, message) {
  client.rpushx(genQueueId(consumerId), message)(tools.logErr);
  // trigger pullMessage
  client.publish(`${redisPrefix}:message`, consumerId);
};

// by rpc, broadcast messages to redis queue
exports.broadcastMessage = function(room, message) {
  client.evalsha(broadcastLuaSHA, 1, genRoomId(room), message);
};

// to consumer, auto pull messages from redis queue
exports.pullMessage = function(consumerId) {
  var socket = exports.consumers[consumerId];
  if (!socket || socket.ioPending) return;

  socket.ioPending = true;
  var queueId = genQueueId(consumerId);
  // 一次批量发送最多 20 条消息
  client.lrange(queueId, 0, 19)(function*(err, messages) {
    if (err) throw err;
    if (!messages.length) return;
    yield socket.sendMessages(messages);
    yield client.ltrim(queueId, messages.length, -1);
    return true;
  })(function(err, res) {
    socket.ioPending = null;
    if (err !== null) tools.logErr(err);
    else if (res === true) exports.pullMessage(consumerId);
  });
};

// List, consumer's message queue key

function genQueueId(consumerId) {
  return `${redisPrefix}:L:${consumerId}`;
}

// Set, room's key
function genRoomId(room) {
  return `${redisPrefix}:S:${room}`;
}

function stripBOM(content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  return content;
}
