#!/usr/bin/env node
/*jshint asi:true, nodejs:true, laxbreak:true*//*!

Created by Thomas Aylott <thomas@subtlegradient.com>
Copyright © 2011 Sencha Labs Foundation
MIT License

!*/

var config = {}

config.root = __dirname + '/../Resources'
config.serverjs = config.root + '/app/server.js'

// BEWARE: THIS IS A SECURITY RISK!
// only allow connections from this machine
// ideally this should probly be https I guess
// Also, there should be some sort of security
// so that nobody else with HTTP access to your machine can't just Do Bad Things.
// That includes others users on the same machine, e.g. guest
config.port = 8842
config.hostname = '127.0.0.1'
config.url = 'http://' + config.hostname + ':' + config.port

////////////////////////////////////////////////////////////////////////////////

var navigator = require('./navigator')

var server = require(config.serverjs)
server.listen(config.port, config.hostname, function(){
    navigator.start(config.url)
})

navigator.onExit = function(){
    console.log('exited the navigator')
    server.close()
    process.exit()
}

process.on('exit', function(){
    console.log('exited the whole app')
})
