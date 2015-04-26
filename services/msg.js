'use strict';

// http://www.jsonrpc.org/specification
// encoding and decoding AMP messages.

const jsonrpc = require('jsonrpc-lite');
const Thunk = require('thunks')();
const requestSet = new Set(['request', 'notification']);

// exports.isRequest = function(message) {
//   var obj = jsonrpc.parse(message);
//   if (requestSet.has(obj.type)) return obj.payload;
//   throw obj.payload instanceof Error ? obj.payload : new jsonrpc.err.InvalidRequestError();
// };

exports.thunkMessage = function(message) {
  var obj = jsonrpc.parse(message);
  if (obj.type !== 'request') return null;
  return Thunk(function(callback) {});
};
