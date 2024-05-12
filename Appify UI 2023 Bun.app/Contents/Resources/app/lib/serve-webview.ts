import type { ServeOptions, Server } from "bun"
import { css, html } from "./html.ts"
import { webviewOpen } from "./webview.ts"

function serveToAnyPort({ port, ...options }: ServeOptions): Server {
  port = Number(port) || 8444
  while (port < 9999) {
    try {
      return Bun.serve({ ...options, port: port })
    } catch (error) {
      console.warn("Port", port, "is in use")
      if ((error as any).code !== "EADDRINUSE") throw error
      port++
    }
  }
  throw new Error("Could not start server")
}

export function create(options: ServeOptions) {
  const server = serveToAnyPort(options)
  const window = webviewOpen(server.url.href)
  window.exited.then(() => server.stop())
  return server
}

if (import.meta.main) {
  test()
  function test() {
    console.log("webview works?")

    const fetcher = (request: Request): Response => {
      console.log("webview works!")

      const styles = css`
        :root {
          color-scheme: light dark;
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
    }

    create({ fetch: fetcher })
    create({ fetch: fetcher })
  }
}
