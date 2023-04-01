const fs = require("fs")
const serverModTime = fs.statSync(__filename).mtime
const serverStartTime = new Date()
function indexPage() {
  return `
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

<h3>use fetch to load JSON when I click this button</h3>
<script> const loadJson = () => fetch("/index.json").then(r => r.json()).then(j => document.querySelector("#json").innerText = JSON.stringify(j, null, 2)) </script>
<button onclick="loadJson()">Load JSON</button>
<pre id="json"></pre>

<form action="/kill" method="post">
  <button type="submit">Kill the server</button>
</form>
`
}

const webviewServer = require("./lib/http-webview").create((request, response) => {
  if (request.url === "/") request.url = "/index.html"
  if (request.url === "/index.html") {
    response.writeHead(200, { "Content-Type": "text/html" })
    response.write(indexPage(request))
    response.end()
    return
  }

  if (request.url === "/index.json") {
    response.writeHead(200, { "Content-Type": "application/json" })
    response.write(JSON.stringify({ hello: "world", time: new Date() }))
    response.end()
    return
  }

  if (request.url === "/kill" && request.method === "POST") {
    response.writeHead(200, { "Content-Type": "text/html" })
    response.write("Killing server...")
    response.end()
    setTimeout(() => {
      webviewServer.close()
    }, 0)
    return
  }

  response.writeHead(404)
  response.end(`Not found: ${request.url}`)
})
