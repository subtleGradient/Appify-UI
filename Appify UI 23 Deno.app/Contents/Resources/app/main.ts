const __filename = decodeURIComponent(new URL(import.meta.url).pathname)
const __dirname = __filename.slice(0, __filename.lastIndexOf("/"))

import * as webviewServer from "./lib/http-webview.ts"
import { html, css } from "./lib/html.ts"

if (import.meta.main) {
  console.log("webview works?")

  webviewServer.create(_req => {
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
