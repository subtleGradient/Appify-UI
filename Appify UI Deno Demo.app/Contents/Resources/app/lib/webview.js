const spawn = require("child_process").spawn

exports.open = url => {
  const child = spawn(`${__dirname}/../../../MacOS/appify-ui-webview`, ["-url", url])
  process.on("exit", () => {
    child.kill("SIGINT")
  })
  process.on("beforeExit", () => {
    child.kill("SIGINT")
  })
  return child
}

if (require.main === module)
  exports.open(
    "https://github.com/subtleGradient/Appify-UI/blob/master/Appify%20UI%20Node%20Demo.app/Contents/Resources/app/lib/webview.js",
  )
