#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('config');
const Thunk = require('thunks')();
const StrikerUtil = require('striker-util');
const contentDisposition = require('content-disposition');

const oss = require('../services/oss');
const tools = require('../services/tools');
const fileParse = require('../services/file');

const readDir = Thunk.thunkify(fs.readdir);
const tmpDir = path.resolve(process.cwd(), config.tmpDir || require('os').tmpDir());
const fileReg = /^12[0-9a-z]{34}\.(doc|docx|dot|odt|rtf|xls|xlsx|ods|ppt|pptx|odp)$/;

Thunk(function*() {
  var files = yield readDir(tmpDir);
  for (var i = 0; i < files.length; i++) {
    if (!fileReg.test(files[i])) continue;
    let file = path.join(tmpDir, files[i]);
    console.log('\nconvert:', file);

    let fileKey = files[i].slice(0, 36);
    let keyInfo = StrikerUtil.parseKey(fileKey);
    let res = yield oss.getHead(keyInfo.storage, fileKey);

    let pdfMeta = {
      fileKey: `${fileKey}.pdf`,
      userId: res.res.headers['x-oss-meta-user'],
      fileType: 'pdf',
      filePath: `${tmpDir}/${fileKey}.pdf`,
      mimeType: 'application/pdf',
      fileCategory: 'application'
    };

    try {
      pdfMeta.fileName = contentDisposition.parse(res.res.headers['content-disposition']).parameters.filename || '';
      pdfMeta.fileName = pdfMeta.fileName.replace(files[i].slice(36), '.pdf');
    } catch (e) {}

    pdfMeta.fileName = pdfMeta.fileName || pdfMeta.fileKey;
    console.log('file info:', pdfMeta);

    let time = Date.now();
    try {
      res = yield tools.exec(`${config.soffice} --headless --invisible --convert-to pdf ${file}`, {
        cwd: config.tmpDir,
        stdio: 'ignore',
        timeout: 1000 * 60 * 2
      });
    } catch(err) {
      console.error(err);
      continue;
    }

    if (res[1]) {
      console.error(res[1]);
      continue;
    }
    if (!res[0].trim().length || res[0].includes('Error:')) {
      console.error(res[0] || 'convert failed');
      continue;
    }
    time = Date.now() - time;
    console.log('convert pdf success: ', `${time / 1000}s`);
    console.log('upload to OSS...');
    tools.deleteFileSafe(file)();
    // upload to OSS
    let client = oss.getOssClient(keyInfo.storage);
    try {
      res = yield oss.uploadLocalFile(fileParse.parseFileMeta(pdfMeta), client);
    } catch (err) {
      console.error(err);
    }
    console.log('upload success', res);
  }
})();
