'use strict'

const Toa = require('toa')
const pm = require('toa-pm')
const ilog = require('ilog')
const config = require('config')
const toaToken = require('toa-token')

const packageInfo = require('../package.json')
const ws = require('./service/ws')
const stats = require('./service/stats')

ilog.level = config.logLevel

const app = module.exports = Toa(function * () {
  if (this.path === '/stats') {
    let token = this.token
    if (token.name !== 'snapper') this.throw(400)
    let res = stats.os()
    res.stats = yield stats.clientsStats()
    this.body = res
  } else {
    this.body = {
      server: packageInfo.name,
      version: packageInfo.version
    }
  }
})

config.instancePort = config.port + (+process.env.NODE_APP_INSTANCE || 0)

app.onerror = function (err) {
  if (!err || err.status < 500) return
  ilog.error(err)
}

toaToken(app, config.tokenSecret, {
  expiresInSeconds: config.expires,
  getToken: function () {
    // both authorization headers and signature query token.
    return this.query.token
  }
})

/**
 * Start up service.
 */
app.listen(config.instancePort, config.backlog, function () {
  ilog.info({
    class: 'snapper-core',
    listen: config.instancePort,
    serverId: stats.serverId
  })
})
ws(app)
// The server is finally closed and exit gracefully when all connections are ended.
pm(app)
