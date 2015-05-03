'use strict';
/*global describe, it, before, after, beforeEach, afterEach*/

const config = require('config');
const assert = require('assert');
const Thunk = require('thunks')();
const Producer = require('snapper2-producer');

const app = require('../app');
const tools = require('../services/tools');
const Consumer = require('./lib/consumer');

describe('snapper2', function() {
  after(function(callback) {
    Thunk(function*() {
      yield Thunk.delay(1000);
      process.exit(0);
    })(callback);
  });

  describe('rpc', function() {

    it('connect:Unauthorized', function(callback) {
      var producer = new Producer(config.rpcPort, {
        secretKeys: 'xxx',
        producerId: 'testRPC'
      });

      producer
        .on('connect', function() {
          assert.strictEqual('Should not run', true);
        })
        .on('error', function(err) {
          assert.strictEqual(err.code, 400);
          this.close();
        })
        .on('close', callback);
    });

    it('connect:success', function(callback) {
      var producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: 'testRPC'
      });

      producer
        .on('connect', function() {
          this.close();
        })
        .on('error', function(err) {
          assert.strictEqual('Should not run', true);
        })
        .on('close', callback);
    });

    it('signAuth', function(callback) {
      var producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: 'testRPC'
      });

      var token = producer.signAuth({test: true});
      assert.strictEqual(app.verifyToken(token).test, true);

      producer.on('close', callback).close();
    });

    it('sendMessage', function(callback) {
      var producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: 'testRPC'
      });

      assert.throws(function() {
        producer.sendMessage('room', 123);
      });
      assert.throws(function() {
        producer.sendMessage(123, 123);
      });
      assert.throws(function() {
        producer.sendMessage('room', '');
      });

      var count = 0;
      producer
        .on('jsonrpc', function(obj) {
          if (obj.result > 0) count += obj.result;
          if (count === this.connection.messagesCount) producer.close();
        })
        .on('close', callback)
        .sendMessage('test', 'a')
        .sendMessage('test', 'b')
        .sendMessage('test', 'c');
    });

    it('joinRoom, leaveRoom', function(callback) {
      var producer = new Producer(config.rpcPort, {
        secretKeys: config.tokenSecret,
        producerId: 'testRPC'
      });

      assert.throws(function() {
        producer.joinRoom('room', 123);
      });
      assert.throws(function() {
        producer.joinRoom(123, 123);
      });
      assert.throws(function() {
        producer.leaveRoom('room', '');
      });

      producer
        .on('error', callback)
        .on('close', callback);

      producer.joinRoom = Thunk.thunkify(producer.joinRoom);
      producer.leaveRoom = Thunk.thunkify(producer.leaveRoom);

      Thunk(function* () {
        var res = yield producer.joinRoom('test', '1');
        assert.strictEqual(res, 'OK');
        yield producer.joinRoom('test', '2');
        assert.strictEqual(res, 'OK');
        yield producer.leaveRoom('test', '1');
        assert.strictEqual(res, 'OK');
        producer.close();
      })();
    });
  });
});
