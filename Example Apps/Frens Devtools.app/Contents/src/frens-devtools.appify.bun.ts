#!/usr/bin/env bun --watch

import { createSecurity } from "./lib/createSecurity"
import { firstOpenPortBetween } from "./lib/firstOpenPortBetween"
import { openBrowser } from "./lib/openBrowser"

/// <reference types="bun" />
export {}
console.log(__filename, "is running")
process.chdir(__dirname)

const html = String.raw

import routes from "./routes"

async function main() {
  const Security = createSecurity()

  const server = Bun.serve({
    port: await firstOpenPortBetween(3333, 4444),
    async fetch(request) {
      try {
        Security.verifyAuth(request)
      } catch (error) {
        console.error(error)
        return new Response("Unauthorized", { status: 401 })
      }

      const url = new URL(request.url)

      if (url.pathname in routes) return routes[url.pathname](request)

      return new Response(html`<h3>Route not found "${url.pathname}"</h3>`, {
        status: 404,
        headers: { "content-type": "text/html" },
      })
    },
  })

  console.log("Server running at", server.url.href)
  const url = Security.protectURL(new URL(server.url))
  console.log("Opening browser to", url.href)

  openBrowser(url.href).exited.finally(() => {
    server.stop(true)
    process.exit(0)
  })
}

process.once("beforeExit", (...args) => console.debug("beforeExit", { args }))
process.once("exit", (...args) => console.debug("exit", { args }))
process.once("SIGHUP", (...args) => console.debug("SIGHUP", { args }))
process.once("SIGINT", (...args) => console.debug("SIGINT", { args }))
process.once("SIGQUIT", (...args) => console.debug("SIGQUIT", { args }))
process.once("SIGTERM", (...args) => console.debug("SIGTERM", { args }))
process.once("SIGKILL", (...args) => console.debug("SIGKILL", { args }))
process.once("SIGABRT", (...args) => console.debug("SIGABRT", { args }))

// @ts-ignore -- top level await is fine here
await main()
