'use strict'

const net = require('toa-net')
const ilog = require('ilog')
const config = require('config')
const thunk = require('thunks')()

const Producer = require('./service/producer')
const stats = require('./service/stats')
const redisClient = require('./service/redis').defaultClient
const auth = new net.Auth(config.tokenSecret)

ilog.level = config.logLevel

const server = module.exports = new net.Server(function (socket) {
  socket.producer = new Producer()
  socket
    .on('error', (err) => {
      if (err.code === 'ECONNRESET') {
        // Filter invalid socket (i.e. probe socket from Server Load Balancer).
        socket.destroy()
      }
      err.class = 'snapper-rpc-socket'
      ilog.error(err)
    })
    .on('close', () => socket.producer.destroy())

  thunk(function * () {
    for (let value of socket) {
      let message = yield value
      let time = Date.now()
      yield socket.handleJsonRpc(message.payload, handleJsonRpc)

      time = Date.now() - time
      if (time > 500) {
        let data = JSON.stringify(message.payload.params)
        ilog.info({
          class: 'handleJsonRpc',
          time: time,
          sid: socket.sid,
          messages: message.payload.params.length,
          queLen: socket.iterQueLen,
          method: message.payload.method,
          params: data.length > 200 ? (data.slice(0, 200) + '...') : data
        })
      }
    }
  })((err) => {
    if (!err || err.code === 'ECONNRESET') return
    err.class = 'snapper-rpc-socket'
    ilog.error(err)
    socket.destroy()
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
    let params = Array.isArray(data.params[0]) ? data.params : [data.params]
    yield params.map((param) => {
      if (validStr(param[0]) && validStr(param[1])) {
        count++
        return this.producer.broadcastMessage(param[0], param[1])
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
      return yield this.producer.joinRoom(data.params[0], data.params[1])

    case 'unsubscribe':
      // params: [room, consumerId]
      if (!validStr(data.params[0]) || !validStr(data.params[1])) this.throw(-32602, data)
      return yield this.producer.leaveRoom(data.params[0], data.params[1])

    case 'consumers':
      // params: [userId]
      if (!validStr(data.params[0])) this.throw(-32602, data)
      return yield this.producer.getUserConsumers(data.params[0])

    case 'echo':
      return data.params

    default:
      this.throw(-32601, data)
  }
}

function validStr (str) {
  return str && typeof str === 'string'
}
