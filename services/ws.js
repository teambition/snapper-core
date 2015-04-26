'use strict';

const config = require('config');
const debug = require('debug')('snapper');
const engine = require('engine.io');
const Thunk = require('thunks')();
const jsonrpc = require('jsonrpc-lite');

const io = require('./io');
const tools = require('./tools');
const TIMEOUT = 60 * 1000;

// return thunk
engine.Socket.prototype.rpcId = 0;
engine.Socket.prototype.ioPending = false;
engine.Socket.prototype.pendingRPC = null;
engine.Socket.prototype.sendMessages = function(messagesArray) {
  return Thunk.call(this, function(callback) {
    var id = ++this.rpcId;
    var msgObj = jsonrpc.request(id, 'put', JSON.parse(`[${messagesArray.join(',')}]`));
    var timer = setTimeout(function() {
      callback(new Error(`Send messages time out, ${this.id}`));
    }, TIMEOUT);

    this.pendingRPC = {
      id: id,
      callback: function(err, res) {
        clearTimeout(timer);
        callback(err, res);
      }
    };
    this.send(JSON.sringify(msgObj));
  });
};

module.exports = function(app) {

  var wsServer = new engine.Server({
    cookie: 'snapper.ws',
    allowRequest: function(req, callback) {
      debug('handshake request: %s', req.url, req._query, req.headers);

      var token = req._query && req._query.token;
      try {
        req.session = app.verifyToken(token);
        if (!/^[a-f0-9]{24}$/.test(req.session.userId)) throw new Error('userId is required');
        req.session.id = tools.base64ID(token);
      } catch (err) {
        debug('handshake request unauthorized: %s', err);
        return callback(3, false); // 'Bad request'
      }

      var prevId = (req.headers.cookie || '').match(/snapper\.ws=([0-9a-zA-Z~_-]{24})/);
      if (prevId && req.session.id !== prevId[1]) req.session.prevId = prevId[1];

      debug('handshake request session: %j', req.session);
      callback(null, true);
    }
  })
  .on('connection', function(socket) {
    debug('socket connected: %s', socket.id, socket.request.session);
    if (socket.request.session.prevId) io.removeConsumer(socket.request.session.prevId);
    io.addConsumer(socket.id);
    socket
      .on('close', function(msg) {
        debug('socket closed: %s', this.id, msg);
      })
      .on('heartbeat', function() {
        debug('socket heartbeat: %s', this.id);
        io.updateConsumer(this.id);
      })
      .on('message', function(data) {
        debug('socket message: %s', this.id, data);

        var res = jsonrpc.parse(data);
        if (res.payload.id !== this.pendingRPC.id) return;
        if (res.type !== 'success' && res.type !== 'error') return;

        var callback = this.pendingRPC.callback;
        this.pendingRPC = null;

        if (res.type === 'error') callback(res.payload.error);
        else callback(null, res.payload.result);
      })
      .on('error', function(err) {
        debug('socket error: %s', this.id, err);
      });

  });

  wsServer.attach(app.server, {path: '/websocket'});
  io.consumers = wsServer.clients;
  return wsServer;
};
