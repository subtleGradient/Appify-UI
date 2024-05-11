const __filename = decodeURIComponent(new URL(import.meta.url).pathname)
const __dirname = __filename.slice(0, __filename.lastIndexOf("/"))

const [APP_ROOT] = __dirname.split("/Contents/")

const WEBVIEW_BIN = `${APP_ROOT}/Contents/MacOS/Appify UI 23.app/Contents/MacOS/Appify UI 23`

export function open(url: URL | string) {
  if (url.toString().startsWith("/")) url = `file://${url}`
  if (typeof url === "string") url = new URL(url)

  console.log(__filename, "open", url.href)

  const child = Deno.run({
    cmd: [WEBVIEW_BIN, "--url", url.href],
    stdout: "inherit",
    stderr: "inherit",
  })

  // wait for process to exit
  child.status().then(status => console.log({ status }))

  return child
}

if (import.meta.main) open(`${__dirname}/webview.html`)
