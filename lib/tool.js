'use strict'

const crypto = require('crypto')

exports.md5 = function (buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = new Buffer(String(buffer))
  return crypto.createHash('md5').update(buffer).digest('hex')
}

// source: 'teambition', 'ios', 'android', 'wp'
exports.session2ID = function (session) {
  let source = (session.source || 't').toLowerCase()
  source = source[0]
  if (!'aiwt'.includes(source)) source = 't'

  let id = `${source}.`
  let timestamp = session.exp.toString(16)
  if (timestamp.length % 2) timestamp = '0' + timestamp
  id += new Buffer(session.userId + timestamp, 'hex').toString('base64')
  return id.replace(/\//g, '_').replace(/\+/g, '-').replace(/=/g, '~')
}

// a: android, i: ios, w: wp, t: web
exports.id2source = function (id) {
  switch (id.slice(0, 2)) {
    case 'a.': return 'android'
    case 'i.': return 'ios'
    // case 'w.': return 'wp'
  }
  return 'web'
}

exports.safeDecodeURIComponent = function (str) {
  try {
    return decodeURIComponent(str)
  } catch (e) {
    return String(str)
  }
}
