import { css, html } from "./lib/html.ts"
import * as webviewServer from "./lib/serve-webview.ts"

const styles = css`
  :root {
    color-scheme: light dark;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans",
      "Helvetica Neue", sans-serif;
  }
`

const handlerMainView = (_req: Request): Response => {
  console.log("webview works!")

  const body = html`
    <style>
      ${styles}
    </style>

    <h1>Appify UI (powered by Bun)</h1>

    <p>
      Edit this app
      <button onclick="editCode()">Edit Code</button>
      <button onclick="editCode(true)">Edit Code (Insiders)</button>
      <script>
        const editCode = async (insiders = false) => await fetch("/edit?insiders=" + (insiders ? 1 : 0), { method: "POST" })
      </script>
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
  webviewServer.create({ fetch: handlerRouter })
}
