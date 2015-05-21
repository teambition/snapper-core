#!/usr/bin/env node
'use strict';

const jws = require('jws');
const config = require('config');

console.log(signAuth({name: 'snapper'}));

function signAuth(payload) {
  payload = payload || {};
  payload.exp = Math.floor(Date.now() / 1000) + config.tokenExpires;

  return sign(payload, config.tokenSecret[0]);
}

function sign(payload, secretOrPrivateKey, options) {
  options = options || {};

  var header = {typ: 'JWT', alg: options.algorithm || 'HS256'};
  return jws.sign({header: header, payload: payload, secret: secretOrPrivateKey});
}
