import type { Subprocess } from "bun"

const [APP_ROOT] = __dirname.split("/Contents/")

const WEBVIEW_BIN = Bun.file(`${APP_ROOT}/Contents/MacOS/Appify UI 23.app/Contents/MacOS/Appify UI 23`)

export function webviewOpen(url: URL | string) {
  if (typeof url === "string") url = new URL(url)

  console.log(__filename, "open", url.href)

  const webview = Bun.spawn([WEBVIEW_BIN.name!, "--url", url.href], {
    stdio: ["ignore", "inherit", "inherit"],
    cwd: APP_ROOT,
  })

  console.log("webview pid", webview.pid)

  webview.exited.then(status => console.log("webview exited", { status }))

  return webview
}

declare global {
  var webviewRef: undefined | { current?: Subprocess }
}

if (import.meta.main) {
  ;(globalThis.webviewRef ??= {}).current?.kill()
  const webview = (webviewRef!.current = webviewOpen(
    Bun.serve({ port: 9873, fetch: () => Response.json({ success: true }) }).url.href,
  ))
  webview.exited.then(() => webviewRef!.current === webview && process.exit(0))
}
