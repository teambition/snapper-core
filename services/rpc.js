'use strict';

const net = require('net');
const Bufsp = require('bufsp');
const config = require('config');
const jsonrpc = require('jsonrpc-lite');
const debug = require('debug')('snapper');

const io = require('./io');
const tools = require('./tools');
const stats = require('./stats');

module.exports = function(app) {
  var server = net.createServer(function(socket) {
    socket.bufsp = new Bufsp({
      encoding: 'utf8',
      returnString: true
    });

    socket.pipe(socket.bufsp);

    socket
      .on('error', function(err) {
        app.onerror(err);
      })
      .on('end', function() {
        if (this.id) delete server.clients[this.id];
      })
      .on('close', function() {
        if (this.id) delete server.clients[this.id];
      });

    socket.bufsp
      .once('data', onAuth)
      .on('error', function(err) {
        app.onerror(err);
      })
      .on('finish', function() {
        socket.bufsp.removeAllListeners();
        socket.removeAllListeners();
        debug('socket finish: %s', socket.producerId);
      });

    function onAuth(message) {
      debug('rpc message: %s', message);

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
      this.on('data', onData);
    }

    function onData(message) {
      debug('rpc message: %s', socket.producerId, message);

      var res = jsonrpc.parse(message);
      if (res.type !== 'request') {
        tools.logErr(new Error(`Receive a unhandle message: ${message}`));
        socket.invalidRequestCount++;
        if (socket.invalidRequestCount > 100)
          socket.end(socket.bufsp.encode(new Error('excessive invalid requests')));
        return;
      }

      handleRPC(socket, res.payload);
    }
  });

  server.clients = Object.create(null);
  server.destroy  = function(callback) {
    for (var id in this.clients) this.clients[id].destroy();
    this.close(callback);
  };

  server.on('error', function(err) {
    // if (err.code === 'EADDRINUSE') {
    //   console.log(`${config.rpcPort} in use, retrying listening...`);
    //   setTimeout(function () {
    //     server.close();
    //     server.listen(config.rpcPort);
    //   }, 1000);
    // }
    app.onerror(err);
  });

  server.listen(config.rpcPort);
  return server;

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
