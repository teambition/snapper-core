'use strict'

const util = require('util')
const crypto = require('crypto')
const createError = require('http-errors')

exports.log = function (err) {
  // cli 调试用
  if (util.isError(err)) arguments[0] = err.stack || err.toString()
  console.log.apply(console, arguments)
}

exports.logInfo = logInfo
function logInfo (name, obj) {
  // stdout
  name = `\n${timestamp()} - ${name}`
  if (!obj) console.log(name)
  else if (util.isError(obj)) console.log(name, `\n${obj.toString()}`)
  else console.log(name, `\n${JSON.stringify(obj)}`)
}

exports.logErr = logErr
function logErr (err) {
  // stdout
  // ignore null and response error
  if (err == null || (err.status && err.status < 500)) return
  if (!util.isError(err)) logInfo('Non-Error throw', err)
  else console.error(`\n${timestamp()} - ${err.toString()}`, `\n${err.stack}`)
}

exports.throw = function () {
  throw createError.apply(null, arguments)
}

exports.createError = function () {
  return createError.apply(null, arguments)
}

exports.md5 = function (buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = new Buffer(String(buffer))
  return crypto.createHash('md5').update(buffer).digest('hex')
}

exports.base64ID = function (buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = new Buffer(String(buffer))
  var id = crypto.createHash('md5').update(buffer).digest('base64')
  return id.replace(/\//g, '_').replace(/\+/g, '-').replace(/=/g, '~')
}

exports.safeDecodeURIComponent = function (str) {
  try {
    return decodeURIComponent(str)
  } catch (e) {
    return String(str)
  }
}

// 2015-03-10 16:19:34
function timestamp () {
  var d = new Date()
  var date = [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('-')
  var time = [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join(':')
  return date + ' ' + time
}

function pad (n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10)
}
