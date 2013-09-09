var webviewServer = require('./lib/http-webview').create(function(request, response){
  
  response.write("<!doctype html>")
  response.write("<meta charset=utf-8>")
  response.write("<title>Hello from Node!</title>")
  
  response.write("<h1>Hello from Node!</h1>")
  
  response.write('<a href="txmt://open?url=file://' + __filename + '">')
  response.write("Edit this app in TextMate")
  response.write('</a>')
  
  response.write('<a href="file://' + __filename + '">')
  response.write("Edit this app")
  response.write('</a>')
  
  response.write('<a href="txmt://open?url=file://' + __filename + '/../../Info.plist">')
  response.write("Be sure to change the CFBundleIdentifier")
  response.write('</a>')
  
  response.end()
});
