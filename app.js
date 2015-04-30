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

const NODE_APP_INSTANCE = +process.env.NODE_APP_INSTANCE || 0;
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

app.config = {
  instance: NODE_APP_INSTANCE
};

/**
 * 启动服务
 */
module.exports = app.listen(config.port + NODE_APP_INSTANCE);

toaToken(app, config.tokenSecret, {expiresInSeconds: config.expires});
app.context.rpc = rpc(app);
app.context.ws = ws(app);

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
  listen: config.port + NODE_APP_INSTANCE,
  rpcPort: config.rpcPort,
  appConfig: app.config
});
