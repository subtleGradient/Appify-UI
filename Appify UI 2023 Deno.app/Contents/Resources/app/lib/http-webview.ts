const __filename = decodeURIComponent(new URL(import.meta.url).pathname)
const __dirname = __filename.slice(0, __filename.lastIndexOf("/"))

import { type Handler, Server } from "https://deno.land/std@0.224.0/http/server.ts"
import { open } from "./webview.ts"

export function create(handler: Handler) {
  const port = 8444
  // TODO: try this port first, if it's not available, try the next one, and so on

  const server = new Server({ port, handler })
  server.listenAndServe()

  const window = open(`http://localhost:${port}`)
  window.status().then(status => {
    // kill the server when the window closes
    server.close()
    // kill the deno process when the window closes
    Deno.exit(status.code)
  })

  return server
}

import { css, html } from "./html.ts"

if (import.meta.main) {
  console.log("webview works?")

  create(_req => {
    console.log("webview works!")

    const styles = css`
      :root {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans",
          "Helvetica Neue", sans-serif;
      }
    `
    const body = html`
      <style>
        ${styles}
      </style>

      <h1>lulz 1</h1>
    `
    return new Response(body, { status: 200, headers: { "content-type": "text/html" } })
  })
}
