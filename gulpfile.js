'use strict'

var gulp = require('gulp')
var gulpSequence = require('gulp-sequence')
var mocha = require('gulp-mocha')

gulp.task('mocha', function () {
  return gulp.src('test/index.js', {read: false})
    .pipe(mocha({timeout: 100000}))
})

gulp.task('default', ['test'])

gulp.task('test', gulpSequence('mocha'))
