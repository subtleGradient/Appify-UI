/*jshint asi:true, nodejs:true, laxbreak:true*/

var http = require('http')
var webview = require('./webview')

exports.create = function(connectionListener){
  
  var port = 8444
  
  var server = http.createServer(connectionListener)
  
  server.on('listening', function(){
    var address = server.address()
    
    var window = webview.open('http://' + address.address + ':' + address.port)
    
    window.on('exit', function(){
      process.exit(0)
    })
  })
  
  server.on('error', function(error){
    if (error.code == 'EADDRINUSE'){
      port++
      server.listen(port)
      return
    }
    throw error
  })
  
  server.listen(port)
  
  return server
}

if (!module.parent) exports.create(function(request, response){
  response.write("Hello from Node!")
  response.end()
})
