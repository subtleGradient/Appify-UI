var webviewServer = require("./lib/http-webview").create((request, response) => {
  response.write(`
<!doctype html>
<meta charset=utf-8>
<title>Hello from Node!</title>

<h1>Hello from Node!</h1>

<p>
  Edit this app
  <input type="text" value="${__filename}" readonly style="width:80%">
</p>
`)

  response.end()
})
