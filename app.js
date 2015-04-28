'use strict';

const Toa = require('toa');
const http = require('http');
const config = require('config');
const toaToken = require('toa-token');
const debug = require('debug')('snapper');
const WsServer = require('engine.io').Server;

const packageInfo = require('./package.json');
const ws = require('./services/ws');
const rpc = require('./services/rpc');
const tools = require('./services/tools');


const app = Toa(function() {
  var res = {
    server: packageInfo.name,
    version: packageInfo.version,
  };

  if (this.config.env === 'development') {
    res.clientsCount = this.ws.clientsCount;
    res.clients = Object.keys(this.ws.clients);
  }
  this.body = res;
});

/**
 * 启动服务
 */
module.exports = app.listen(config.port);

toaToken(app, config.tokenSecret, {expiresInSeconds: config.expires});
// app.context.rpc = rpc(app);
app.context.ws = ws(app);

tools.logInfo('start', {
  listen: config.port,
  appConfig: app.config
});
