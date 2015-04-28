'use strict';

const fs = require('fs');
const config = require('config');
const redis = require('thunk-redis');
const debug = require('debug')('snapper');

const tools = require('./tools');

const redisPrefix = config.redisPrefix;
const expires = config.redisQueueExpires;
const messageChannel = `${redisPrefix}:message`;

const client = redis.createClient(config.redis.port, config.redis.host);
const clientSub = redis.createClient(config.redis.port, config.redis.host);
const broadcastLua = stripBOM(fs.readFileSync('lua/broadcast.lua', {encoding: 'utf8'}))
  .replace(/REDIS_PREFIX/g, redisPrefix);

var broadcastLuaSHA = null;
client.script('load', broadcastLua)(function(err, res) {
  if (err) throw err;
  debug('io add lua:', res);
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
  .on('message', function(channel, consumerIds) {
    if (channel !== messageChannel) return;
    debug('io message:', channel, consumerIds);

    consumerIds = consumerIds.split(' ');
    for (var i = 0; i < consumerIds.length; i++) {
      if (consumerIds[i]) exports.pullMessage(consumerIds[i]);
    }
  })
  .subscribe(messageChannel)(tools.logErr);

// should replace by ws' clients
exports.consumers = {};

// by ws, add consumer's message queue
exports.addConsumer = function(consumerId) {
  var queueId = genQueueId(consumerId);
  // init messages queue
  client.lindex(queueId, 0)(function*(err, res) {
    var initTask = [];
    if (err) initTask.push(client.del(queueId));
    if (!res) initTask.push(client.rpush(queueId, '1'));
    if (initTask.length) yield initTask;

    debug('io addConsumer:', consumerId);
    yield client.expire(queueId, expires);
    exports.pullMessage(consumerId);
  })(tools.logErr);
};

exports.updateConsumer = function(consumerId) {
  client.expire(genQueueId(consumerId), expires)(tools.logErr);
};

// by ws, clear consumer's message queue
exports.removeConsumer = function(consumerId) {
  debug('io removeConsumer:', consumerId);
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
    debug('io joinRoom:', room, consumerId);

    // stale room will be del after 172800 sec
    yield client.expire(roomId, 172800);
  })(tools.logErr);
};

// by rpc, remove consumer from room
exports.leaveRoom = function(room, consumerId) {
  debug('io leaveRoom:', room, consumerId);

  client.srem(genRoomId(room), consumerId)(tools.logErr);
};

// by rpc, push messages to redis queue
exports.pushMessage = function(consumerId, message) {
  debug('io pushMessage:', consumerId, message);

  client.rpushx(genQueueId(consumerId), message)(function(err, res) {
    if (err !== null) throw err;
    // trigger pullMessage
    return client.publish(messageChannel, consumerId);
  })(tools.logErr);
};

// by rpc, broadcast messages to redis queue
exports.broadcastMessage = function(room, message) {
  debug('io broadcastMessage:', room, message);
  client.evalsha(broadcastLuaSHA, 1, genRoomId(room), message)(tools.logErr);
};

// to consumer, auto pull messages from redis queue
exports.pullMessage = function(consumerId) {
  var socket = exports.consumers[consumerId];
  if (!socket || socket.ioPending) return;

  socket.ioPending = true;
  var queueId = genQueueId(consumerId);
  // 一次批量发送最多 20 条消息，index 0 为占位消息（`'1'` 或上一次的已读消息），空 list 会被自动删除。
  client.lrange(queueId, 1, 20)(function*(err, messages) {
    if (err) throw err;
    if (!messages.length) return;

    debug('io pullMessage:', consumerId, messages);
    yield socket.sendMessages(messages);
    yield client.ltrim(queueId, messages.length, -1);
    return true;
  })(function(err, res) {
    socket.ioPending = false;
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
