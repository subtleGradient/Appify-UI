import type { ServeOptions } from "bun"
import { css, html, js } from "./lib/html.ts"
import * as webviewServer from "./lib/serve-webview.ts"

const styles = css`
  :root {
    color-scheme: light dark;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans",
      "Helvetica Neue", sans-serif;
  }
`

const routes: Record<string, ServeOptions["fetch"]> = {}

class FakeServerAction<P> {
  constructor(public readonly pathname: string, public readonly fetch: ServeOptions["fetch"]) {
    routes[this.pathname] = this.fetch
  }
  onClick(params: P) {
    return js`fetch(${JSON.stringify(this.pathname)}, {
      method: "POST",
      body: ${JSON.stringify(params)},
      headers: { "Content-Type": "application/json" }
    }).then(response => response.text()).then(alert)`
  }
}

const editAction = new FakeServerAction("/edit", async (req: Request) => {
  const body = await req.json()
  const { wantsInsiders } = body

  console.log("handlerEdit")
  if (req.method !== "POST") {
    console.warn("Error; Endpoint requires POST")
    return new Response("Error; Endpoint requires POST", { status: 401, headers: { "content-type": "text/html" } })
  }
  console.log("Opening VSCode…")
  const result = await Bun.$`/usr/local/bin/code${wantsInsiders ? "-insiders" : ""} ${__dirname}/../..`

  return Response.json(
    { result: result.text() },
    { status: result.exitCode === 0 ? 200 : 500, statusText: result.exitCode === 0 ? "OK" : "Error" },
  )
})

const handlerMainView = (request: Request): Response => {
  console.log("webview works!")

  const body = html`
    <style>
      ${styles}
    </style>

    ${request.url}

    <h1>Appify UI (powered by Bun)</h1>

    <p>
      Edit this app
      <button onclick="${editAction.onClick({})}">Edit Code</button>
      <button onclick="${editAction.onClick({ wantsInsiders: true })}">Edit Code (Insiders)</button>
    </p>
  `
  return new Response(body, { status: 200, headers: { "content-type": "text/html" } })
}

const handlerEdit = async (req: Request): Promise<Response> => {
  const url = new URL(req.url)
  const wantsInsiders = url.searchParams.get("insiders") === "1"

  console.log("handlerEdit")
  if (req.method !== "POST") {
    console.warn("Error; Endpoint requires POST")
    return new Response("Error; Endpoint requires POST", { status: 400, headers: { "content-type": "text/html" } })
  }
  // if (??? !== "darwin") {
  //   console.warn("NOT IMPLEMENTED")
  //   return new Response("NOT IMPLEMENTED", { status: 400, headers: { "content-type": "text/html" } })
  // } else
  {
    console.log("Opening VSCode…")
    // const vscode = Bun.run({
    //   cmd: ["/usr/local/bin/code" + (wantsInsiders ? "-insiders" : ""), `${__dirname}/../..`],
    //   stdout: "piped",
    //   stderr: "piped",
    // })
    Bun.$`/usr/local/bin/code${wantsInsiders ? "-insiders" : ""} ${__dirname}/../..`
    // const { code } = await vscode.status()
    // console.log("VSCode exited with code", code)
    // if (code !== 0) {
    //   const rawError = await vscode.stderrOutput()
    //   const errorString = new TextDecoder().decode(rawError)
    //   return new Response(errorString, { status: 500, headers: { "content-type": "text/html" } })
    // }
    return new Response("Done", { status: 200, headers: { "content-type": "text/html" } })
  }
}

export const router: ServeOptions["fetch"] = async (req, server) => {
  const url = new URL(req.url)
  if (url.pathname in routes) return await routes[url.pathname].call(server, req, server)

  console.log("handlerRouter", req.url)
  if (url.pathname === "/edit") return await handlerEdit(req)
  return handlerMainView(req)
}

if (import.meta.main) {
  console.log("starting webview server…")
  webviewServer.create({ fetch: router })
}
