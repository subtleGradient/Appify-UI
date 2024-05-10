const __filename = decodeURIComponent(new URL(import.meta.url).pathname)
const __dirname = __filename.slice(0, __filename.lastIndexOf("/"))

import * as webviewServer from "./lib/http-webview.ts"
import { html, css } from "./lib/html.ts"

const styles = css`
  :root {
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

    <!-- edit -->
    <p>
      Edit this app
      <button onclick="editCode()">Edit Code</button>
      <script>
        const editCode = async () => await fetch("/edit", { method: "POST" })
      </script>
    </p>

    <!-- prompt -->
    <p>
      <label for="prompt">Prompt</label>
      <textarea id="prompt" name="prompt" rows="10" cols="50"></textarea>
    </p>

    <!-- submit -->
    <p><button onclick="submit()">Submit</button></p>
    <script>
      const submit = async () => {
        const prompt = document.getElementById("prompt").value
        const response = await fetch("/openai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        })
        const json = await response.json()
        console.log("json", json)
      }
    </script>

    <!-- response -->
    <p>
      <label for="response">Response</label>
      <textarea id="response" name="response" rows="10" cols="50"></textarea>
    </p>
  `
  return new Response(body, { status: 200, headers: { "content-type": "text/html" } })
}

const handlerRouter = async (req: Request): Promise<Response> => {
  console.log("handlerRouter", req.url)
  if (new URL(req.url).pathname === "/edit") return await handlerEdit(req)
  if (new URL(req.url).pathname === "/openai") return await handlerOpenAI(req)
  return handlerMainView(req)
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

async function handlerOpenAI(req: Request): Promise<Response> {
  console.log("handlerOpenAI")
  if (req.method !== "POST") {
    console.warn("Error; Endpoint requires POST")
    return new Response("Error; Endpoint requires POST", { status: 400, headers: { "content-type": "text/html" } })
  }
  const body = await req.json()
  console.log("body", body)
  const response = await fetch("https://api.openai.com/v1/engines/davinci/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: body.prompt,
      max_tokens: 5,
      temperature: 0.9,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      stop: ["\n"],
    }),
  })
  const json = await response.json()
  console.log("json", json)
  return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } })
}

if (import.meta.main) {
  console.log("starting webview server…")
  webviewServer.create(handlerRouter)
}
