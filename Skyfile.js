'use strict'
/*global sneaky*/

sneaky('snapper2:ga', function () {
  this.description = 'Deploy to ga environment'
  this.user = 'jarvis'
  this.host = '112.124.19.227'
  this.path = '/teambition/server/snapper-ga'
  this.filter = `
+ config/d*
- config/*
- debug
- examples
- node_modules
- test
- .*`

  this.after('npm install --production')
  this.overwrite = true
  this.nochdir = true
})

sneaky('snapper2:dev', function () {
  // Description show in `sneaky -T`
  this.description = 'Deploy to test environment'
  this.user = 'iojs'
  this.host = '192.168.0.21'
  this.path = '/home/iojs/snapper-iojs'

  // Ignore the src directory
  // Filter pattern
  this.filter = `
+ config/d*
- config/*
- debug
- examples
- node_modules
- .*`

  // Execute before transporting files to server
  // this.before('coffee -o lib -c src')

  // Execute after transporting files to server and link to the current directory
  // This script will be executed through ssh command
  this.after('npm install && npm test && pm2 gracefulReload snapper-dev')

  // Normally, sneaky will create a new directory for each deployment
  // If you do not need this feature, set `overwrite` to true
  this.overwrite = true

  // In the `prepare` step, Sneaky archive the git repos and unarchive files to
  // a temporary directory located in $HOME/.sneaky/$APP_NAME, and chdir to this directory.
  // If you do not need this feature and want to execute this task in the current directory,
  // set `nochdir` to true
  this.nochdir = true
})
