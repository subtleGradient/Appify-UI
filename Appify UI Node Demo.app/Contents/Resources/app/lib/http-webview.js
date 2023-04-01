const http = require("http")
const webview = require("./webview")

exports.create = connectionListener => {
  let port = 8444

  const server = http.createServer(connectionListener)

  server.on("listening", () => {
    const address = server.address()
    if (address.address == "::") address.address = "localhost"
    const window = webview.open("http://" + address.address + ":" + address.port)

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

  return server
}

if (require.main === module) {
  exports.create((request, response) => {
    response.write("Hello from Node!")
    response.end()
  })
}
