'use strict';
/*global describe, it, before, after, beforeEach, afterEach*/

const assert = require('assert');
const config = require('config');
const Thunk = require('thunks')();
const Producer = require('snapper2-producer');

const tools = require('../services/tools');
const Consumer = require('./lib/consumer');

const clients = Object.create(null);
const host = 'http://push.teambition.net';

const producer = new Producer(config.rpcPort, 'push.teambition.net', {
  secretKeys: config.tokenSecret,
  producerId: 'testRPC'
});

exports.clients = clients;
exports.producer = producer;

exports.add = function(n) {
  n = n > 0 ? +n : 1;

  Thunk(function*() {
    while (n--) {
      let consumerId = yield addClient();
      let res = yield addToRoom(consumerId);
    }
    console.log('added!');
  })();
};

exports.clear = function() {
  for (let key in clients) clients[key].connection.emit('close');
};

function addToRoom(consumerId) {
  return function(callback) {
    producer.joinRoom('benchmark', consumerId, callback);
  };
}

var addCount = 0;
var delCount = 0;
function addClient() {
  return function(callback) {
    var token = producer.signAuth({userId: Consumer.genUserId()});
    var client = new Consumer.MiniWebSocket(host, token);
    client.connection
      .once('error', function(err) {
        console.error('error:', this.id, err);
        callback(err);
      })
      .once('open', function() {
        console.log('connected:', addCount++, this.id);
        client.id = this.id;
        clients[this.id] = client;
        callback(null, this.id);
      })
      .once('close', function() {
        console.log('close:', delCount++, client.id);
        delete clients[client.id];
        client.disconnect();
      });
  };
}
