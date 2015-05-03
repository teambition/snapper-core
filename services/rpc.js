'use strict';

const net = require('net');
const Bufsp = require('bufsp');
const config = require('config');
const jsonrpc = require('jsonrpc-lite');
const debug = require('debug')('snapper');

const io = require('./io');
const tools = require('./tools');

module.exports = function(app) {
  var server = net.createServer(function(socket) {
    socket.bufsp = new Bufsp({
      encoding: 'utf8',
      returnString: true
    });

    socket.pipe(socket.bufsp);

    socket
      .on('error', function(err) {
        tools.logErr(err);
        this.end(err.message);
      });

    socket.bufsp
      .once('data', onAuth)
      .on('finish', function() {
        socket.bufsp.removeAllListeners();
        socket.removeAllListeners();
        debug('socket finish: %s', socket.producerId);
      });

    function onAuth(message) {
      debug('rpc message: %s', message);

      var res = jsonrpc.parse(message);
      if (res.type !== 'request' || res.payload.method !== 'auth')
        return socket.end('Unauthorized: ' + message);

      if (!handleRPC(socket, res.payload)) return socket.end();
      // ready to listen
      socket.invalidRequestCount = 0;
      this.on('data', onData);
    }

    function onData(message) {
      debug('rpc message: %s', socket.producerId, message);

      var res = jsonrpc.parse(message);
      if (res.type !== 'request') {
        tools.logErr(new Error(`Receive a unhandle message: ${message}`));
        socket.invalidRequestCount++;
        if (socket.invalidRequestCount > 100) socket.end('excessive invalid requests');
        return;
      }

      handleRPC(socket, res.payload);
    }
  });

  server.listen(config.rpcPort);
  return server;

  function handleRPC(socket, data) {
    var res = jsonrpc.success(data.id, 'OK');

    switch (data.method) {
      case 'publish':
        // params: [
        //   [room1, message1],
        //   [room2, message2]
        //   ...
        // ]
        res.result = 0;
        while (data.params.length) {
          let param = data.params.shift();
          if (validString(param[0]) && validString(param[1])) {
            res.result++;
            io.broadcastMessage(param[0], param[1]);
          }
        }
        if (socket.invalidRequestCount) socket.invalidRequestCount--;
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
          if (!validString(socket.token.producerId)) throw new Error('invalid signature');
          socket.producerId = socket.token.producerId;
        } catch (err) {
          res = jsonrpc.error(data.id, new jsonrpc.JsonRpcError(err.message, 400));
          socket.write(socket.bufsp.encode(JSON.stringify(res)));
          return false;
        }
        break;

      default:
        socket.invalidRequestCount++;
        res = jsonrpc.error(data.id, jsonrpc.JsonRpcError.methodNotFound());
    }

    socket.write(socket.bufsp.encode(JSON.stringify(res)));
    return true;
  }
};

function validString(str) {
  return str && typeof str === 'string';
}
