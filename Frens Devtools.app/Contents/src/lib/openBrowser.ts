const [APP_ROOT] = __dirname.split("/Contents/")

const browserExecutable = Bun.file(`${APP_ROOT}/Contents/MacOS/apache-callback-mac`)
if ((await browserExecutable.exists()) === false) throw new Error("Browser not found at " + browserExecutable.name!)

export function openBrowser(url: URL | string) {
  console.debug("Opening browser to", { url })
  return Bun.spawn([browserExecutable.name!, "-url", url.toString()], {
    cwd: __dirname,
    stdio: ["ignore", "inherit", "inherit"],
  })
}
