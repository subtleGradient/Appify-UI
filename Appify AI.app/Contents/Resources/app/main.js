function html(strings, ...values) {
  return strings
    .map((string, index) => {
      let value = values[index]
      if (value === undefined) return string
      if (typeof value === "function") value = value()
      return string + value
    })
    .join("")
}
const fs = require("fs")
const { exec } = require("child_process");

const serverModTime = fs.statSync(__filename).mtime
const serverStartTime = new Date()
function indexPage() {
  return html`
    <!DOCTYPE html>
    <meta charset="utf-8" />
    <title>Hello from Node!</title>

    <h1>Hello from Node!</h1>
    <p>
      Edit this app
      <button onclick="editCode()">Edit Code</button>
      <script>
        const editCode = async () => await fetch("/edit", { method: "POST" });
      </script>
    </p>

    <form id="apiForm">
      <label for="inputText">Type something:</label>
      <input type="text" id="inputText" />
      <button type="submit">Send to server</button>
    </form>
    <div id="outputBox">
      <h3>Server response:</h3>
      <pre id="outputText"></pre>
    </div>

    <li>
      Address:
      <script>
        document.write(location)
      </script>
    </li>
    <li>Modified at: ${serverModTime}</li>
    <li>Started at: ${serverStartTime}</li>
    <li>
      Loaded at: ${new Date()}

      <h3>use fetch to load JSON when I click this button: <button onclick="loadJson()">Load JSON</button></h3>
      <pre id="json"></pre>
      <script>
        const loadJson = () =>
          fetch("/index.json")
            .then(r => r.json())
            .then(j => (document.querySelector("#json").innerText = JSON.stringify(j, null, 2)))
      </script>

      <form action="/kill" method="post">Don't <button type="submit">Kill the server</button></form>
    </li>

    <script>
      document.querySelector("#apiForm").addEventListener("submit", async e => {
        e.preventDefault()

        const inputText = document.querySelector("#inputText").value
        const response = await fetch("/api", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: inputText }),
        })

        const transformedText = await response.json()
        document.querySelector("#outputText").innerText = transformedText.text
      })
    </script>
  `
}

const router = (request, response) => {
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
    setTimeout(() => webviewServer.close(), 0)
    return
  }

  if (request.url === "/api" && request.method === "POST") {
    let body = ""
    request.on("data", chunk => {
      body += chunk
    })

    request.on("end", async () => {
      const { text } = JSON.parse(body)
      const transformedText = text.split("").reverse().join("")

      response.writeHead(200, { "Content-Type": "application/json" })
      response.write(JSON.stringify({ text: transformedText }))
      response.end()
    })

    return
  }

  if (request.url === "/edit" && request.method === "POST") {
    exec(`/usr/local/bin/code "${__dirname}"`, err => {
      response.writeHead(err ? 500 : 200, { "Content-Type": "application/json" });
      response.write(JSON.stringify(err ? { error: "Failed to execute the command." } : { success: "Command executed successfully." }));
      response.end();
    });
    return;
  }

  response.writeHead(404)
  response.end(`Not found: ${request.url}`)
}

const webviewServer = require("./lib/http-webview").create(router)
