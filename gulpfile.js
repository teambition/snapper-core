'use strict';

var gulp = require('gulp'),
  gulpSequence = require('gulp-sequence'),
  jshint = require('gulp-jshint'),
  mocha = require('gulp-mocha');

gulp.task('jshint', function () {
  return gulp.src(['app.js', 'gulpfile.js', 'test/*.js'])
    .pipe(jshint())
    .pipe(jshint.reporter('default'));
});

gulp.task('mocha', function () {
  return gulp.src('test/*.js', {read: false})
    .pipe(mocha({timeout: 10000}));
});

gulp.task('default', ['test']);

gulp.task('test', gulpSequence('jshint', 'mocha'));
