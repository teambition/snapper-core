'use strict'

const config = require('config')
const ilog = require('ilog')

module.exports = ilog

ilog.level = config.logLevel

const errorify = ilog._errorify

ilog._errorify = function (error) {
  if (error.stack) {
    // clear thunks error stack info
    error.stack = error.stack
      .replace(/^\s*at.*thunks\.js.*$/gm, '')
      .replace(/\n+/g, '\n')
  }
  return errorify(error)
}
