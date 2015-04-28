'use strict';

const net = require('net');
const config = require('config');
const jsonrpc = require('jsonrpc-lite');
const debug = require('debug')('snapper');

const io = require('./io');
const tools = require('./tools');

module.exports = function(app) {
  var server = net.createServer(function(socket) {
    socket
      .once('data', onAuth)
      .on('error', function(err) {
        tools.logErr(err);
        this.end(err.message);
      });
  });

  server.listen(config.rpcPort);
  return server;

  function onAuth(chunk) {
    var data = chunk.toString();
    debug('socket message: %s', data);

    data = jsonrpc.parse(data);
    if (data.type !== 'request' || data.payload.method !== 'auth')
      return this.end('Unauthorized: ' + chunk);

    if (!handleRPC(this, data.payload)) return this.end();
    // ready to listen
    this.invalidRequestCount = 0;
    this.on('data', onData);
  }

  function onData(chunk) {
    var data = chunk.toString();
    debug('socket message: %s', data);

    data = jsonrpc.parse(data);
    if (data.type !== 'request') {
      tools.logErr(new Error(`Receive a unhandle message: ${data}`));
      this.invalidRequestCount++;
      if (this.invalidRequestCount > 100) this.end('excessive invalid requests');
      return;
    }

    handleRPC(this, data.payload);
  }

  function handleRPC(socket, data) {
    var res = jsonrpc.success(data.id, 'OK');

    switch (data.method) {
      case 'publish':
        // params: [
        //   [room1, message1],
        //   [room2, message2]
        //   ...
        // ]
        while (data.params.length) {
          let param = data.params.shift();
          if (validString(param[0]) && validString(param[1]))
            io.broadcastMessage(param[0], param[1]);
        }
        break;

      case 'subscribe':
        // params: [room, consumerId]
        if (validString(data.params[0]) && validString(data.params[1]))
          io.joinRoom(data.params[0], data.params[1]);
        break;

      case 'unsubscribe':
        // params: [room, consumerId]
        if (validString(data.params[0]) && validString(data.params[1]))
          io.joinRoom(data.params[0], data.params[1]);
        break;

      case 'auth':
        // params: [tokenxxx]
        try {
          socket.token = app.verifyToken(data.params[0]);
          // producer token should have producerId, to different from consumer auth
          if (!validString(socket.token.producerId)) throw new Error('invalid token');
        } catch (err) {
          res = jsonrpc.error(data.id, new jsonrpc.JsonRpcError(err.message, 0));
          socket.write(JSON.stringify(res));
          return false;
        }
        break;

      default:
        this.invalidRequestCount++;
        res = jsonrpc.error(data.id, jsonrpc.JsonRpcError.methodNotFound());
    }

    socket.write(JSON.stringify(res));
    return true;
  }
};

function validString(str) {
  return str && typeof str === 'string';
}
