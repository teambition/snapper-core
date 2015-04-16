'use strict';

const Toa = require('toa');
const config = require('config');
const toaBody = require('toa-body');
const toaToken = require('toa-token');

const tools = require('./services/tools');
const restAPI = require('./services/rest');

/**
 * 启动服务
 */

const app = Toa(function*(Thunk) {
  this.set('access-control-allow-credentials', 'true');
  this.set('access-control-allow-origin', this.get('origin') || '*');
  this.set('access-control-allow-methods', 'GET, POST, DELETE, HEAD, OPTIONS');
  this.set('access-control-allow-headers', 'authorization');
  yield restAPI.route(this, Thunk);
});

config.env = app.config.env;
app.onerror = tools.logErr;

toaBody(app);
toaToken(app, config.tokenSecret, {
  expiresInSeconds: config.expires,
  getToken: function() {
    if (!/^(GET|HEAD)$/.test(this.method)) return;
    return this.query.Signature; // GET 请求同时允许 Authorization header 和 Signature query
  }
});

module.exports = app.listen(config.port);

tools.logInfo('start', {
  listen: config.port,
  appConfig: app.config
});
