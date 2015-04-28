'use strict';

const config = require('config');
const engine = require('engine.io');
const Thunk = require('thunks')();
const jsonrpc = require('jsonrpc-lite');
const debug = require('debug')('snapper');

const io = require('./io');
const tools = require('./tools');
const TIMEOUT = 60 * 1000;

// return thunk
engine.Socket.prototype.rpcId = 0;
engine.Socket.prototype.ioPending = false;
engine.Socket.prototype.pendingRPC = null;
engine.Socket.prototype.sendMessages = function(messages) {
  return Thunk.call(this, function(callback) {
    var ctx = this;
    var socketId = this.id;
    var rpcId = ++this.rpcId;
    var msgObj = jsonrpc.request(rpcId, 'publish', messages);
    var timer = setTimeout(function() {
      ctx.pendingRPC.callback(new Error(`Send messages time out, socketId ${socketId}, rpcId ${rpcId}`));
    }, TIMEOUT);

    this.pendingRPC = {
      id: rpcId,
      callback: function(err, res) {
        clearTimeout(timer);
        ctx.pendingRPC = null;
        callback(err, res);
      }
    };
    this.send(JSON.stringify(msgObj));
    debug('ws send rpc:', msgObj);
  });
};

engine.Server.prototype.generateId = function(req) {
  return req.session.id;
};

module.exports = function(app) {

  var wsServer = new engine.Server({
    cookie: 'snapper.ws',
    allowRequest: function(req, callback) {
      debug('ws handshake: %s', req.url, req._query, req.headers);

      var token = req._query && req._query.token;
      try {
        req.session = app.verifyToken(token);
        if (!/^[a-f0-9]{24}$/.test(req.session.userId)) throw new Error('userId is required');
        req.session.id = tools.base64ID(token);
      } catch (err) {
        debug('ws handshake unauthorized: %s', err);
        return callback(3, false); // 'Bad request'
      }

      var prevId = (req.headers.cookie || '').match(/snapper\.ws=([0-9a-zA-Z~_-]{24})/);
      if (prevId && req.session.id !== prevId[1]) req.session.prevId = prevId[1];
      callback(null, true);
    }
  });

  wsServer.on('connection', function(socket) {
    var session = socket.request.session;
    debug('ws connected: %s', socket.id, session);
    if (session.prevId) io.removeConsumer(session.prevId);
    // init consumer's message queue if not exist
    io.addConsumer(socket.id);

    // bind consumer to user's room
    // a user may have one more consumer's thread
    io.joinRoom(session.userId, socket.id);
    socket
      .on('heartbeat', function() {
        // debug('ws heartbeat: %s', this.id);
        io.updateConsumer(this.id);
      })
      .on('message', function(data) {
        debug('ws message: %s', this.id, data);
        if (!this.pendingRPC) return;

        var res = jsonrpc.parse(data);
        if (res.payload.id !== this.pendingRPC.id) return;

        if (res.type === 'success') {
          this.pendingRPC.callback(null, res.payload.result);
        } else {
          this.pendingRPC.callback(res.payload.error || res.payload);
        }
      })
      .on('error', function(err) {
        debug('ws error: %s', this.id, err);
      });

    if (app.config.env === 'development') {
      socket.on('close', function(msg) {
        debug('ws closed: %s', this.id, msg);
      });
    }

  });

  wsServer.attach(app.server, {path: '/websocket'});
  io.consumers = wsServer.clients;
  return wsServer;
};
