'use strict';
/*global describe, it, before, after, beforeEach, afterEach*/

const config = require('config');
const assert = require('assert');
const request = require('supertest');
const Thunk = require('thunks')();

const snapper = require('../app');
const tools = require('../services/tools');
