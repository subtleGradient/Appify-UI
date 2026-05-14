#!/usr/bin/env -S osascript -l JavaScript

function run(argv) {
  const appPath = argv[0]
  const expectedBundleIdentifier = argv[1]
  const documentPath = argv[2]
  const app = Application.currentApplication()
  app.includeStandardAdditions = true

  const systemEvents = Application("System Events")
  const deadline = Date.now() + 8000

  const shellQuote = value => `'${String(value).replace(/'/g, "'\\''")}'`
  const delaySeconds = seconds => delay(seconds)
  const appifyProcesses = () => systemEvents.processes.whose({ name: "Appify UI" })()
  const appifyProcess = () => appifyProcesses()[0]
  const fail = message => {
    throw new Error(message)
  }
  const waitUntil = (message, predicate) => {
    while (Date.now() <= deadline) {
      const value = predicate()
      if (value) return value
      delaySeconds(0.1)
    }
    fail(message)
  }
  const quitApp = () => {
    try {
      Application("Appify UI").quit()
      delaySeconds(0.2)
    } catch (_) {}
  }
  const openApp = extraArguments => {
    app.doShellScript(`open -n -a ${shellQuote(appPath)}${extraArguments ? ` ${extraArguments}` : ""}`)
  }
  const assertLegitProcess = () => {
    const process = waitUntil("Appify UI process did not appear", () => appifyProcess())
    process.frontmost = true

    waitUntil("Appify UI bundle identifier was not visible", () => process.bundleIdentifier())
    const bundleIdentifier = process.bundleIdentifier()
    if (bundleIdentifier !== expectedBundleIdentifier) {
      fail(`Expected bundle identifier ${expectedBundleIdentifier} but saw ${bundleIdentifier}`)
    }

    waitUntil("Appify UI process is not frontmost", () => process.frontmost())

    if (process.menuBars.length < 1) {
      fail("Appify UI has no menu bar")
    }

    const menuBar = process.menuBars[0]
    if (menuBar.menuBarItems.whose({ name: "File" })().length < 1) {
      fail("Appify UI has no File menu")
    }
    if (menuBar.menuBarItems.whose({ name: "Appify UI" })().length < 1) {
      fail("Appify UI has no application menu")
    }

    return process
  }

  quitApp()

  try {
    openApp("")
    let process = assertLegitProcess()
    waitUntil("Appify UI did not present a window or open panel", () => process.windows.length > 0)
    let windowName = process.windows[0].name()
    if (windowName !== "Open Web App") {
      fail(`Expected direct-launch open panel named Open Web App but saw ${windowName}`)
    }
    quitApp()

    if (documentPath) {
      openApp(shellQuote(documentPath))
      process = assertLegitProcess()
      waitUntil("Appify UI did not present the document window", () => process.windows.length > 0)
      windowName = process.windows[0].name()
      if (windowName !== "Hello") {
        fail(`Expected Hello document window but saw ${windowName}`)
      }

      delaySeconds(2)
      if (appifyProcesses().length < 1) {
        fail("Appify UI exited while opening Hello.webapp")
      }
    }

    quitApp()
    return `Appify UI smoke ok: ${appPath}`
  } catch (error) {
    quitApp()
    throw error
  }
}
