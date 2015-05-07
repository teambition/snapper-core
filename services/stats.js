'use strict';

const os = require('os');
const config = require('config');
const debug = require('debug')('snapper');

const redis = require('./redis');
const tools = require('./tools');

const network = os.networkInterfaces();
const serverId = tools.base64ID(JSON.stringify(network));
const statsKey = `${config.redisPrefix}:STATS`;
const roomKey = `${config.redisPrefix}:STATS:ROOM`;
const serverKey = `${config.redisPrefix}:STATS:SERVERS`;


exports.serverId = serverId;

exports.os = function() {
  var res = {
    net: network,
    serverId: serverId,
    mem: {
      free: (os.freemem() / 1024 / 1204).toFixed(2) + ' MB',
      total: (os.totalmem() / 1024 / 1204).toFixed(2) + ' MB'
    }
  };
  return res;
};

exports.incrProducerMessages = function(count) {
  redis.client.hincrby(statsKey, 'producerMessages', count)(tools.logErr);
};

exports.incrConsumerMessages = function(count) {
  redis.client.hincrby(statsKey, 'consumerMessages', count)(tools.logErr);
};

exports.incrConsumers = function(count) {
  redis.client.hincrby(statsKey, 'consumers', count)(tools.logErr);
};

exports.addRoomsHyperlog = function(roomId) {
  redis.client.pfadd(roomKey, roomId)(tools.logErr);
};

exports.setConsumersStats = function(consumers) {
  redis.client.hset(serverKey, `${serverId}:${config.instancePort}`, consumers)(tools.logErr);
};

exports.clientsStats = function*() {
  var res = yield [
    redis.client.pfcount(roomKey),
    redis.client.hgetall(statsKey),
    redis.client.hgetall(serverKey)
  ];
  res[1].rooms = '' + res[0];
  return {
    total: res[1],
    current: res[2]
  };
};
