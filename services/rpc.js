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
      .once('data', function(chunk) {
        chunk = chunk.toString();
        debug('socket message: %s', chunk);
        try {
          socket.token = app.verifyToken(JSON.parse(chunk).token);
        } catch (err) {
          return socket.end('Unauthorized: ' + err);
        }
        this.write('OK');

        socket.on('data', function(chunk) {
          var data = chunk.toString();
          debug('socket message: %s', data);

          var res = jsonrpc.parse(data);
          if (res.type !== 'request') {
            tools.logErr(new Error(`Receive a unhandle message: ${data}`));
            return;
          }

          this.write(JSON.stringify(jsonrpc.success(res.payload.id, 'OK')));

          var messages = res.payload.params;
          while (messages.length) {
            let message = messages.shift();
            if (typeof message.room !== 'string' || typeof message.message !== 'string')
              continue;
            io.broadcastMessage(message.room, message.message);
          }
        });
      })
      .on('error', function(err) {
        tools.logErr(err);
        this.end();
      });
  });

  server.listen(config.rpcPort);
  return server;
};
