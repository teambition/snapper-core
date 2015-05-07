'use strict';

const Toa = require('toa');
const http = require('http');
const config = require('config');
const toaToken = require('toa-token');
const debug = require('debug')('snapper');

const packageInfo = require('./package.json');
const ws = require('./services/ws');
const rpc = require('./services/rpc');
const tools = require('./services/tools');
const stats = require('./services/stats');

const app = Toa(function*() {
  debug('http request:', this.method, this.url, this.ip);
  var res = {
    server: packageInfo.name,
    version: packageInfo.version,
  };

  if (/^development|ga$/.test(this.config.env)) {
    res = stats.os();
    res.stats = yield stats.clientsStats();
  }
  this.body = res;
});

config.instancePort = config.port + (+process.env.NODE_APP_INSTANCE || 0);

app.connectRPC = function() {
  this.context.rpc = rpc(this);
};
app.connectWS = function() {
  this.context.ws = ws(this);
};

/**
 * 启动服务
 */

app.listen(config.instancePort);
toaToken(app, config.tokenSecret, {expiresInSeconds: config.expires});
app.connectRPC();
app.connectWS();

module.exports = app;

// pm2 gracefulReload
app.onmessage = function(msg) {
  if (msg === 'shutdown') {
    this.context.rpc.close(function() {
      app.server.close(function() {
        process.exit(0);
      });
    });
  }
};

tools.logInfo('start', {
  listen: config.instancePort,
  rpcPort: config.rpcPort,
  serverId: stats.serverId,
  appConfig: app.config,
});
