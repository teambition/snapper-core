'use strict'

const crypto = require('crypto')

exports.md5 = function (buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = new Buffer(String(buffer))
  return crypto.createHash('md5').update(buffer).digest('hex')
}

exports.session2ID = function (session) {
  // a: android, i: iOS, w: Web
  let id = (session.type || 'w') + '.'
  let timestamp = session.exp.toString(16)
  if (timestamp % 2) timestamp = '0' + timestamp
  id += new Buffer(session.userId + timestamp, 'hex').toString('base64')
  return id.replace(/\//g, '_').replace(/\+/g, '-').replace(/=/g, '~')
}

exports.safeDecodeURIComponent = function (str) {
  try {
    return decodeURIComponent(str)
  } catch (e) {
    return String(str)
  }
}
