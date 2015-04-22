'use strict';

const config = require('config');
const PullSocket = require('axon').PullSocket;
const debug = require('debug')('snapper');
const Message = require('amp-message');
const Parser = require('amp').Stream;
const tools = require('./tools');

module.exports = function(app) {

  // overwrite
  PullSocket.prototype.addSocket = function(sock) {
    var ctx = this;
    var parser = new Parser();
    var i = this.socks.push(sock) - 1;
    debug('add socket %d', i);
    sock.pipe(parser);
    // verify token first, if failed, end the socket
    parser.once('data', function(chunk) {
      try {
        sock.token = app.verifyToken(JSON.parse(chunk.toString()).token);
      } catch (err) {
        return sock.end('Unauthorized: ' + err);
      }
      parser.on('data', function(chunk){
        var msg = new Message(chunk);
        ctx.emit.apply(ctx, ['message', sock].concat(msg.args));
      });
    });
  };

  var socketServer = new PullSocket();

  socketServer.bind(config.rpcPort);

  socketServer.on('message', function(msg) {
    console.log('message', msg);
  });
  return socketServer;
};
