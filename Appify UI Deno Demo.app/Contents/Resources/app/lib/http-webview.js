const http = require("http")
const webview = require("./webview")

exports.create = connectionListener => {
  let port = 8444
  // PROBLEM: localStorage will not be shared between different ports

  const server = http.createServer(connectionListener)

  server.on("listening", () => {
    let { address, port } = server.address()
    if (address == "::") address = "localhost"
    const window = webview.open(`http://${address}:${port}`)

    window.on("exit", () => process.exit(0))
  })

  server.on("error", error => {
    if (error.code == "EADDRINUSE") {
      port++
      server.listen(port)
      return
    }
    throw error
  })

  server.listen(port)

  server.on("close", () => process.exit(0))

  return server
}

if (require.main === module) {
  exports.create((request, response) => {
    response.write("Hello from Node!")
    response.end()
  })
}
