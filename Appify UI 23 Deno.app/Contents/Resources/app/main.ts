const __filename = decodeURIComponent(new URL(import.meta.url).pathname)
const __dirname = __filename.slice(0, __filename.lastIndexOf("/"))

import * as webviewServer from "./lib/http-webview.ts"
import { html, css } from "./lib/html.ts"

const handlerMainView = (_req: Request): Response => {
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

    <h1>Appify UI (powered by Deno)</h1>

    <p>
      Edit this app
      <button onclick="editCode()">Edit Code</button>
      <script>
        const editCode = async () => await fetch("/edit", { method: "POST" })
      </script>
    </p>
  `
  return new Response(body, { status: 200, headers: { "content-type": "text/html" } })
}

const handlerEdit = async (req: Request): Promise<Response> => {
  console.log("handlerEdit")
  if (req.method !== "POST") {
    console.warn("Error; Endpoint requires POST")
    return new Response("Error; Endpoint requires POST", { status: 400, headers: { "content-type": "text/html" } })
  }
  if (Deno.build.os !== "darwin") {
    console.warn("NOT IMPLEMENTED")
    return new Response("NOT IMPLEMENTED", { status: 400, headers: { "content-type": "text/html" } })
  } else {
    console.log("Opening VSCode…")
    const vscode = Deno.run({
      cmd: ["/usr/local/bin/code", `${__dirname}/../..`],
      stdout: "piped",
      stderr: "piped",
    })
    const { code } = await vscode.status()
    console.log("VSCode exited with code", code)
    if (code !== 0) {
      const rawError = await vscode.stderrOutput()
      const errorString = new TextDecoder().decode(rawError)
      return new Response(errorString, { status: 500, headers: { "content-type": "text/html" } })
    }
    return new Response("Done", { status: 200, headers: { "content-type": "text/html" } })
  }
}

const handlerRouter = async (req: Request): Promise<Response> => {
  console.log("handlerRouter", req.url)
  if (new URL(req.url).pathname === "/edit") return await handlerEdit(req)
  return handlerMainView(req)
}

if (import.meta.main) {
  console.log("starting webview server…")
  webviewServer.create(handlerRouter)
}
