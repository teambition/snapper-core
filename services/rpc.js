'use strict';

const net = require('net');
const Bufsp = require('bufsp');
const config = require('config');
const jsonrpc = require('jsonrpc-lite');
const debug = require('debug')('snapper:rpc');

const io = require('./io');
const tools = require('./tools');
const stats = require('./stats');
const probeIps = Object.create(null);

module.exports = function(app) {
  var server = net.createServer(function(socket) {
    debug('connection:', socket.remoteAddress, socket.remotePort);
    // filter invalid socket, such as probe socket from Server Load Balancer
    if (!socket.remoteAddress || !socket.remotePort || probeIps[socket.remoteAddress] > 5) {
      socket.on('error', noOp);
      return;
    }

    socket.bufsp = new Bufsp({
      encoding: 'utf8',
      returnString: true
    });
    socket.bufsp.socket = socket;
    socket.pipe(socket.bufsp);

    socket
      .on('error', onSocketError)
      .on('end', onSocketClose)
      .on('close', onSocketClose);

    socket.bufsp
      .once('data', onAuth)
      .on('error', app.onerror);
  });

  server.clients = Object.create(null);
  server.destroy  = function(callback) {
    for (let id in this.clients) this.clients[id].destroy();
    this.close(callback);
  };

  server.on('error', app.onerror);
  server.listen(config.rpcPort);
  return server;

  function onSocketError(err) {
    if (err.code === 'ECONNRESET') {
      debug('probe connection:', this.remoteAddress, err);
      probeIps[this.remoteAddress] = (probeIps[this.remoteAddress] || 0) + 1;
      return;
    }
    app.onerror(err);
  }

  function onSocketClose() {
    if (this.id) delete server.clients[this.id];
  }

  function onAuth(message) {
    var socket = this.socket;
    debug('message:', message);

    var res = jsonrpc.parse(message);
    if (res.type !== 'request')
      return socket.end(socket.bufsp.encode(new Error(`Receive a unhandle message: ${message}`)));

    if (res.payload.method !== 'auth') {
      res = jsonrpc.error(res.payload.id, new jsonrpc.JsonRpcError('Unauthorized: ' + message, 400));
      return socket.end(socket.bufsp.encode(JSON.stringify(res)));
    }

    if (!handleRPC(socket, res.payload)) return socket.end();

    // ready to listen
    socket.invalidRequestCount = 0;
    server.clients[socket.id] = socket;
    // it is not probe socket
    delete probeIps[socket.remoteAddress];
    this.on('data', onData);
  }

  function onData(message) {
    var socket = this.socket;
    debug('message:', socket.producerId, message);

    var res = jsonrpc.parse(message);
    if (res.type !== 'request') {
      app.onerror(new Error(`Receive a unhandle message: ${message}`));
      socket.invalidRequestCount++;
      if (socket.invalidRequestCount > 100)
        socket.end(socket.bufsp.encode(new Error('excessive invalid requests')));
      return;
    }

    handleRPC(socket, res.payload);
  }

  function handleRPC(socket, data) {
    var res = null;
    switch (data.method) {
      case 'publish':
        // params: [
        //   [room1, message1],
        //   [room2, message2]
        //   ...
        // ]
        var count = 0;
        while (data.params.length) {
          let param = data.params.shift();
          if (validString(param[0]) && validString(param[1])) {
            count++;
            io.broadcastMessage(param[0], param[1]);
          }
        }
        stats.incrProducerMessages(count);
        if (socket.invalidRequestCount) socket.invalidRequestCount--;
        res = jsonrpc.success(data.id, count);
        socket.write(socket.bufsp.encode(JSON.stringify(res)));
        break;

      case 'subscribe':
        // params: [room, consumerId]
        if (validString(data.params[0]) && validString(data.params[1]))
          io.joinRoom(data.params[0], data.params[1])(function(err, res) {
            if (err) res = jsonrpc.error(data.id, new jsonrpc.JsonRpcError(String(err), 500));
            else res = jsonrpc.success(data.id, res);
            socket.write(socket.bufsp.encode(JSON.stringify(res)));
          });
        break;

      case 'unsubscribe':
        // params: [room, consumerId]
        if (validString(data.params[0]) && validString(data.params[1]))
          io.leaveRoom(data.params[0], data.params[1])(function(err, res) {
            if (err) res = jsonrpc.error(data.id, new jsonrpc.JsonRpcError(String(err), 500));
            else res = jsonrpc.success(data.id, res);
            socket.write(socket.bufsp.encode(JSON.stringify(res)));
          });
        break;

      case 'auth':
        // params: [tokenxxx]
        try {
          socket.token = app.verifyToken(data.params[0]);
          // producer token should have producerId, to different from consumer auth
          if (!validString(socket.token.producerId)) throw new Error('invalid signature');
          socket.id = tools.base64ID(data.params[0]);
          socket.producerId = socket.token.producerId;
          res = jsonrpc.success(data.id, {id: socket.id});
          socket.write(socket.bufsp.encode(JSON.stringify(res)));
        } catch (err) {
          res = jsonrpc.error(data.id, new jsonrpc.JsonRpcError(err.message, 400));
          socket.write(socket.bufsp.encode(JSON.stringify(res)));
          return false;
        }
        break;

      default:
        socket.invalidRequestCount++;
        res = jsonrpc.error(data.id, jsonrpc.JsonRpcError.methodNotFound());
        socket.write(socket.bufsp.encode(JSON.stringify(res)));
    }

    return true;
  }
};

function validString(str) {
  return str && typeof str === 'string';
}

function noOp() {}
