'use strict'

const crypto = require('crypto')

exports.md5 = function (buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = new Buffer(String(buffer))
  return crypto.createHash('md5').update(buffer).digest('hex')
}

exports.base64ID = function (buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = new Buffer(String(buffer))
  let id = crypto.createHash('md5').update(buffer).digest('base64')
  return id.replace(/\//g, '_').replace(/\+/g, '-').replace(/=/g, '~')
}

exports.safeDecodeURIComponent = function (str) {
  try {
    return decodeURIComponent(str)
  } catch (e) {
    return String(str)
  }
}
