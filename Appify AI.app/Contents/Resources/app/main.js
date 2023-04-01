const fs = require("fs")
const serverModTime = fs.statSync(__filename).mtime
const serverStartTime = new Date()

const webviewServer = require("./lib/http-webview").create((request, response) => {
  response.write(`
  <!doctype html>
  <meta charset=utf-8>
  <title>Hello from Node!</title>
  
  <h1>Hello from Node!</h1>
  <p>
    Edit this app
    <input type="text" value="${__filename}" readonly style="width:80%">
  </p>
  
  <li>Modified at: ${serverModTime}
  <li>Started at: ${serverStartTime}
  <li>Loaded at: ${new Date()}  
  `)

  const wasModified = fs.statSync(__filename).mtime > serverStartTime
  if (wasModified) {
    response.write(`<p style="color:red">Server code was modified. Kill the app and relaunch it to see the changes</p>`)
  }

  response.end()
})
