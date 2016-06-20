'use strict'

const ilog = require('ilog')
const engine = require('engine.io')
const thunk = require('thunks')()
const jsonrpc = require('jsonrpc-lite')
const debug = require('debug')('snapper:ws')

const stats = require('./stats')
const io = require('./consumer')
const producer = require('./producer')

const TIMEOUT = 100 * 1000

module.exports = function (app) {
  const wsServer = new engine.Server({
    cookie: 'snapper.ws',
    allowRequest: (req, callback) => {
      thunk(function * () {
        let token = req._query && req._query.token
        req.session = app.verifyToken(token)
        if (!/^[a-f0-9]{24}$/.test(req.session.userId)) throw new Error('userId is required')
        req.session.id = yield io.genConsumerId(req.session)

        // Weaken previous message queue's lifetime to boost its expiration.
        // heartbeat time will restore its lifetime if connection is still valid.
        let prevId = (req.headers.cookie || '').match(/snapper\.ws=([0-9a-zA-Z.~_-]{24,})/)
        if (prevId) prevId = prevId[1]
        if (!prevId) prevId = req._query.sid
        if (prevId && req.session.id !== prevId) io.weakenConsumer(prevId)
        // Hack: clear previous socket
        if (wsServer.clients[req.session.id]) wsServer.clients[req.session.id].clearTransport()
      })((err) => {
        if (err == null) callback(null, true)
        else callback(3, false)
      })
    }
  })

  wsServer
    .on('error', (error) => {
      ilog.emergency(error)
      // the application should restart if error occured
      throw error
    }) // should not be listened
    .on('connection', (socket) => {
      let session = socket.request.session
      socket.userId = session.userId
      debug('connected: %s', socket.id, session)
      // Initialize consumer's message queue if it does not exist.
      thunk(function * () {
        yield io.addConsumer(socket.id)
        yield [
          // Bind a consumer to a specified user's room.
          // A user may have one or more consumer's threads.
          producer.joinRoom(`user${session.userId}`, socket.id),
          // update user's online consumer
          io.addUserConsumer(socket.userId, socket.id)
        ]
        // start pull message
        io.pullMessage(socket.id)
        // Update consumer's stats.
        stats.incrConsumers(1)
        stats.setConsumersStats(Object.keys(wsServer.clients).length)
      })((error) => {
        if (error) {
          ilog.error(error)
          return socket.end()
        }
      })

      socket
        .on('heartbeat', () => {
          debug('heartbeat: %s', socket.id)
          // if clients dont have socket, but socket is connected, close it!
          // this happened in firefox, just close it so that brower will reconnect server.
          if (!wsServer.clients[socket.id]) socket.close()
          else io.updateConsumer(socket.userId, socket.id)
        })
        .on('message', onMessage)
        .on('error', ilog.error)
        .once('close', () => {
          io.removeUserConsumer(socket.userId, socket.id)
          stats.setConsumersStats(Object.keys(wsServer.clients).length)
        })
    })

  wsServer.attach(app.server, {path: '/websocket'})
  io.consumers = wsServer.clients
  return wsServer
}

engine.Socket.prototype.rpcId = 0
engine.Socket.prototype.userId = null
engine.Socket.prototype.ioPending = false
engine.Socket.prototype.pendingRPC = null
engine.Socket.prototype.sendMessages = function (messages) {
  return thunk.call(this, (callback) => {
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
  this.timer = setTimeout(() => {
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
    let params = res.payload.params == null ? null : res.payload.params
    let data = JSON.stringify(jsonrpc.success(res.payload.id, params))
    return this.send(data)
  }

  if (!this.pendingRPC || res.payload.id !== this.pendingRPC.id) {
    let data = JSON.stringify(jsonrpc.notification('invalid', [res]))
    let err = new Error('invalid message')
    err.id = this.id
    err.data = res
    err.class = 'websocket'
    ilog.error(err)
    return this.send(data)
  }

  if (res.type === 'success') {
    this.pendingRPC.done(null, res.payload.result)
  } else {
    this.pendingRPC.done(res.payload.error || res.payload)
  }
}
