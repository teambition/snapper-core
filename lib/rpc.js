'use strict'

const net = require('toa-net')
const ilog = require('ilog')
const config = require('config')
const thunk = require('thunks')()

const producer = require('./service/producer')
const stats = require('./service/stats')
const redisClient = require('./service/redis').defaultClient
const auth = new net.Auth(config.tokenSecret)

ilog.level = config.logLevel

const server = module.exports = new net.Server(function (socket) {
  socket
    .on('error', (err) => {
      if (err.code === 'ECONNRESET') {
        // Filter invalid socket (i.e. probe socket from Server Load Balancer).
        socket.destroy()
      }
      err.class = 'snapper-rpc-socket'
      ilog.error(err)
    })

  thunk(function * () {
    for (let value of socket) {
      let message = yield value
      let time = Date.now()
      yield socket.handleJsonRpc(message.payload, handleJsonRpc)
      time = Date.now() - time
      if (time > 200) {
        ilog.info({
          class: 'handleJsonRpc',
          time: time,
          method: message.payload.method,
          params: message.payload.params
        })
      }
    }
  })((err) => {
    if (!err || err.code === 'ECONNRESET') return
    err.class = 'snapper-rpc-socket'
    ilog.error(err)
  })
})

server.getAuthenticator = function () {
  return (signature) => auth.verify(signature)
}

server.on('error', function (error) {
  ilog.emergency(error)
  // the application should restart if error occured
  throw error
})

redisClient.clientReady(() => {
  server.listen(config.rpcPort, () => {
    ilog.info({
      class: 'snapper-rpc',
      listen: config.rpcPort,
      serverId: stats.serverId
    })
  })
})

// graceful stop
process.on('message', function (message) {
  if (message === 'shutdown') {
    server.close(function () {
      process.exit(0)
    })
  }
})

function * handleJsonRpc (data) {
  // request or notification
  if (data.method === 'publish') {
    // data.params: [
    //   [room1, message1],
    //   [room2, message2]
    //   ...
    // ]
    let count = 0
    yield data.params.map((param) => {
      if (validStr(param[0]) && validStr(param[1])) {
        count++
        return producer.broadcastMessage(param[0], param[1])
      }
    })
    stats.incrProducerMessages(count)
    return count
  }

  // only request
  switch (data.name === 'request' && data.method) {
    case 'subscribe':
      // params: [room, consumerId]
      if (!validStr(data.params[0]) || !validStr(data.params[1])) this.throw(-32602, data)
      return yield producer.joinRoom(data.params[0], data.params[1])

    case 'unsubscribe':
      // params: [room, consumerId]
      if (!validStr(data.params[0]) || !validStr(data.params[1])) this.throw(-32602, data)
      return yield producer.leaveRoom(data.params[0], data.params[1])

    case 'consumers':
      // params: [userId]
      if (!validStr(data.params[0])) this.throw(-32602, data)
      return yield producer.getUserConsumers(data.params[0])

    default:
      this.throw(-32601, data)
  }
}

function validStr (str) {
  return str && typeof str === 'string'
}
