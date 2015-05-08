'use strict';
/*global describe, it, before, after, beforeEach, afterEach*/

const util = require('util');
const crypto = require('crypto');
const assert = require('assert');
const jsonrpc = require('jsonrpc-lite');
const Engine = require('engine.io-client');
const EventEmitter = require('events').EventEmitter;

module.exports = WebSocket;
WebSocket.genUserId = genUserId;

// use to benchmark
WebSocket.MiniWebSocket = MiniWebSocket;

function WebSocket(host, token) {
  this.host = host;
  this.token = token;
  this.DELAY = (Math.ceil(Math.random() * 10) + 5);
  this.connectDelay = this.DELAY;
  this.connection = null;
  this.connect();
  EventEmitter.call(this);
}
util.inherits(WebSocket, EventEmitter);

WebSocket.prototype.connect = function() {
  var ctx = this;
  if (this.connection) this.connection.removeAllListeners();

  this.connection = new Engine(this.host, {
    path: '/websocket',
    rememberUpgrade: true,
    query: `token=${this.token}`
  });

  this.connection
    .on('open', function() {
      ctx.connectDelay = ctx.DELAY;
      ctx.id = this.id;
      ctx.emit('open');
    })
    .on('close', function(err) {
      if (err) ctx.emit('error', err);
      if (ctx.connectDelay > 600000 || !ctx.connection) return;

      setTimeout(function() {
        ctx.connectDelay *= 1.5;
        ctx.connect();
      }, ctx.connectDelay);
    })
    .on('error', function(err) {
      ctx.emit('error', err);
    })
    .on('message', function(message) {
      var res = jsonrpc.parse(message);

      if (res.type !== 'request') ctx.emit('error', new Error('Only request can be handle'));
      // response to server
      this.send(JSON.stringify(jsonrpc.success(res.payload.id, 'OK')));
      ctx.emit('jsonrpc', res.payload);
      while (res.payload.params.length) {
        try {
          var data = JSON.parse(res.payload.params.shift());
          if (data && typeof data.e === 'string') ctx.emit(data.e, data.d);
          else ctx.emit('message', data);
        } catch (err) {
          ctx.emit('error', err);
        }
      }
    });
};

WebSocket.prototype.disconnect = function() {
  if (!this.connection) return;
  var connection = this.connection;
  this.connection = null;
  this.emit('close');
  connection.removeAllListeners();
  connection.close();
};

function MiniWebSocket(host, token) {
  this.host = host;
  this.token = token;
  this.connection = null;
  this.connect();
}

MiniWebSocket.prototype.connect = function() {
  var ctx = this;
  this.connection = new Engine(this.host, {
    path: '/websocket',
    rememberUpgrade: true,
    query: `token=${this.token}`
  });

  this.messageCount = 0;

  this.connection
    .on('message', function(message) {
      var res = jsonrpc.parse(message);
      if (res.type === 'request') {// response to server
        this.send(JSON.stringify(jsonrpc.success(res.payload.id, 'OK')));
        ctx.latestMessages = res.payload.params;
        ctx.messageCount += res.payload.params.length;
      }
    });
};

MiniWebSocket.prototype.disconnect = function() {
  if (!this.connection) return;
  var connection = this.connection;
  this.connection = null;

  connection.close();
};

var userId = 0;
function genUserId() {
  return crypto.createHash('md5').update(new Buffer(++userId + '')).digest('hex').slice(0, 24);
}
