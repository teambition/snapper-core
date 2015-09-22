'use strict'

const crypto = require('crypto')
const Consumer = require('snapper-consumer')

module.exports = Consumer
Consumer.genUserId = genUserId

Consumer.prototype.message = function (message) {}
Consumer.prototype.onmessage = function (event) {
  if (event.type !== 'request') {
    return this.onerror(new Error('It is not a request: ' + JSON.stringify(event.data)))
  }
  while (event.data.params.length) {
    try {
      this.message(JSON.parse(event.data.params.shift()))
    } catch (err) {
      this.onerror(err)
    }
  }
}

var userId = 0
function genUserId () {
  return crypto.createHash('md5').update(new Buffer(++userId + '')).digest('hex').slice(0, 24)
}
