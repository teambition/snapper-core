'use strict';

const config = require('config');
const Router = require('toa-router');

/**
 * 配置 router
 */

const router = module.exports = new Router();

// router
//   .post('/forremote', remoteAPI.forremote)
//   .post('/archive', archiveAPI.archive)
//   .post('/upload', objectAPI.upload)
//   .get('/storage/:fileKey', objectAPI.get)
//   .head('/storage/:fileKey', objectAPI.head)
//   .get('/thumbnail/:fileKey/w/:width/h/:height', objectAPI.thumbnail)
//   .otherwise(function() {
//     this.body = {
//       server: packageInfo.name,
//       version: packageInfo.version
//     };
//   });
