'use strict';

const config = require('config');
const engine = require('engine.io');
const Thunk = require('thunks')();
const jsonrpc = require('jsonrpc-lite');
const debug = require('debug')('snapper:ws');

const io = require('./io');
const tools = require('./tools');
const stats = require('./stats');

const TIMEOUT = 60 * 1000;

module.exports = function(app) {

  var wsServer = new engine.Server({
    cookie: 'snapper.ws',
    allowRequest: function(req, callback) {
      debug('connect instance: %s', app.config.instance);
      debug('handshake: %s', req.url, req._query, JSON.stringify(req.headers));

      var token = req._query && req._query.token;
      try {
        req.session = app.verifyToken(token);
        if (!/^[a-f0-9]{24}$/.test(req.session.userId)) throw new Error('userId is required');
        req.session.id = tools.base64ID(token);
      } catch (err) {
        debug('handshake unauthorized: %s', err);
        return callback(3, false); // 'Bad request'
      }

      var prevId = (req.headers.cookie || '').match(/snapper\.ws=([0-9a-zA-Z~_-]{24})/);
      if (prevId && req.session.id !== prevId[1]) req.session.prevId = prevId[1];
      callback(null, true);
    }
  });

  wsServer
    .on('error', app.onerror)
    .on('connection', function(socket) {
      var session = socket.request.session;
      debug('connected: %s', socket.id, session);
      if (session.prevId) io.removeConsumer(session.prevId);
      // init consumer's message queue if not exist
      io.addConsumer(socket.id);

      // bind consumer to user's room
      // a user may have one more consumer's thread
      io.joinRoom(session.userId, socket.id)(function(err) {
        if (err) return socket.end();
        // update stats
        stats.incrConsumers(1);
        stats.setConsumersStats(wsServer.clientsCount);
      });

      socket
        .on('heartbeat', onHeartbeat)
        .on('message', onMessage)
        .on('error', app.onerror);

  });

  wsServer.attach(app.server, {path: '/websocket'});
  io.consumers = wsServer.clients;
  return wsServer;
};

engine.Socket.prototype.rpcId = 0;
engine.Socket.prototype.ioPending = false;
engine.Socket.prototype.pendingRPC = null;
engine.Socket.prototype.sendMessages = function(messages) {
  return Thunk.call(this, function(callback) {
    var ctx = this;
    this.pendingRPC = new RpcCommand(this, messages, callback);
    this.send(this.pendingRPC.data);
    debug('send rpc:', this.pendingRPC.data);
  });
};

engine.Server.prototype.generateId = function(req) {
  return req.session.id;
};

function RpcCommand(socket, messages, callback) {
  var ctx = this;
  this.id = ++socket.rpcId;
  this.socket = socket;
  this._callback = callback;

  this.data = JSON.stringify(jsonrpc.request(this.id, 'publish', messages));
  this.timer = setTimeout(function() {
    ctx.callback(new Error(`Send messages time out, socketId ${socket.id}, rpcId ${ctx.id}`));
  }, TIMEOUT);
}

RpcCommand.prototype.clear = function() {
  if (!this.timer) return false;
  clearTimeout(this.timer);
  this.timer = null;
  this.socket.pendingRPC = null;
  return true;
};

RpcCommand.prototype.callback = function(err, res) {
  if (this.clear()) this._callback(err, res);
};

function onHeartbeat() {
  debug('heartbeat: %s', this.id);
  io.updateConsumer(this.id);
}

function onMessage(data) {
  debug('message: %s', this.id, data);
  if (!this.pendingRPC) return;

  var res = jsonrpc.parse(data);
  if (res.payload.id !== this.pendingRPC.id) return;

  if (res.type === 'success') {
    this.pendingRPC.callback(null, res.payload.result);
  } else {
    this.pendingRPC.callback(res.payload.error || res.payload);
  }
}
