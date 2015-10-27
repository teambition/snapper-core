'use strict'

const engine = require('engine.io')
const thunk = require('thunks')()
const jsonrpc = require('jsonrpc-lite')
const debug = require('debug')('snapper:ws')

const io = require('./io')
const tools = require('./tools')
const stats = require('./stats')

const TIMEOUT = 100 * 1000

module.exports = function (app) {
  var wsServer = new engine.Server({
    cookie: 'snapper.ws',
    allowRequest: function (req, callback) {
      debug('connect instance: %s', app.config.instance)
      debug('handshake: %s', req.url, req._query, JSON.stringify(req.headers))

      var token = req._query && req._query.token
      try {
        req.session = app.verifyToken(token)
        if (!/^[a-f0-9]{24}$/.test(req.session.userId)) throw new Error('userId is required')
        req.session.id = tools.base64ID(token)
      } catch (err) {
        debug('handshake unauthorized: %s', err)
        // Bad request.
        return callback(3, false)
      }

      var prevId = (req.headers.cookie || '').match(/snapper\.ws=([0-9a-zA-Z~_-]{24})/)
      if (prevId && req.session.id !== prevId[1]) req.session.prevId = prevId[1]
      callback(null, true)
    }
  })

  wsServer
    .on('error', app.onerror)
    .on('connection', function (socket) {
      var session = socket.request.session
      var consumerId = socket.id
      debug('connected: %s', consumerId, session)
      // Weaken previous message queue's lifetime to boost its expiration.
      // heartbeat time will restore its lifetime if connection is still valid.
      if (session.prevId) io.weakenConsumer(session.prevId)
      // Initialize consumer's message queue if it does not exist.
      io.addConsumer(consumerId)
      io.addUserConsumer(session.userId, consumerId)

      // Bind a consumer to a specified user's room.
      // A user may have one or more consumer's threads.
      io.joinRoom(`user${session.userId}`, consumerId)(function (err) {
        if (err) return socket.end()
        // Update consumer's stats.
        stats.incrConsumers(1)
        stats.setConsumersStats(wsServer.clientsCount)
      })

      socket
        .on('heartbeat', function () {
          debug('heartbeat: %s', this.id)
          io.updateConsumer(this.id)
          // if clients dont have socket, but socker is connected, close it!
          // this happened in firefox, just close it so that brower will reconnect server.
          if (!wsServer.clients[this.id]) this.close()
        })
        .on('message', onMessage)
        .on('error', app.onerror)
        .once('close', function () {
          io.removeUserConsumer(session.userId, consumerId)
          stats.setConsumersStats(wsServer.clientsCount)
        })
    })

  wsServer.attach(app.server, {path: '/websocket'})
  io.consumers = wsServer.clients
  return wsServer
}

engine.Socket.prototype.rpcId = 0
engine.Socket.prototype.ioPending = false
engine.Socket.prototype.pendingRPC = null
engine.Socket.prototype.sendMessages = function (messages) {
  return thunk.call(this, function (callback) {
    this.pendingRPC = new RpcCommand(this, messages, callback)
    this.send(this.pendingRPC.data)
    debug('send rpc:', this.pendingRPC.data)
  })
}

engine.Server.prototype.generateId = function (req) {
  return req.session.id
}

function RpcCommand (socket, messages, callback) {
  var ctx = this
  this.id = ++socket.rpcId
  this.socket = socket
  this.callback = callback

  this.data = JSON.stringify(jsonrpc.request(this.id, 'publish', messages))
  this.timer = setTimeout(function () {
    ctx.done(new Error(`Send messages time out, socketId ${socket.id}, rpcId ${ctx.id}`))
  }, TIMEOUT)
}

RpcCommand.prototype.clear = function () {
  if (!this.timer) return false
  clearTimeout(this.timer)
  this.timer = null
  this.socket.pendingRPC = null
  return true
}

RpcCommand.prototype.done = function (err, res) {
  if (this.clear()) this.callback(err, res)
}

function onMessage (data) {
  debug('message: %s', this.id, data)
  var res = jsonrpc.parse(data)
  if (res.type === 'request') {
    // Echo client requests for testing purposes.
    let data = JSON.stringify(jsonrpc.success(res.payload.id, res.payload.params))
    return this.send(data)
  }

  if (!this.pendingRPC || res.payload.id !== this.pendingRPC.id) return
  if (res.type === 'success') {
    this.pendingRPC.done(null, res.payload.result)
  } else {
    this.pendingRPC.done(res.payload.error || res.payload)
  }
}
