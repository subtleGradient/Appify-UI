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
  const lazyGitProcesses = () => systemEvents.processes.whose({ name: "LazyGit" })()
  const lazyGitProcess = () => lazyGitProcesses()[0]
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
      Application("LazyGit").quit()
      delaySeconds(0.2)
    } catch (_) {}
  }
  const openApp = extraArguments => {
    app.doShellScript(`open -n -a ${shellQuote(appPath)}${extraArguments ? ` ${extraArguments}` : ""}`)
  }
  const assertLegitProcess = () => {
    const process = waitUntil("LazyGit process did not appear", () => lazyGitProcess())
    process.frontmost = true

    waitUntil("LazyGit bundle identifier was not visible", () => process.bundleIdentifier())
    const bundleIdentifier = process.bundleIdentifier()
    if (bundleIdentifier !== expectedBundleIdentifier) {
      fail(`Expected bundle identifier ${expectedBundleIdentifier} but saw ${bundleIdentifier}`)
    }

    waitUntil("LazyGit process is not frontmost", () => process.frontmost())

    if (process.menuBars.length < 1) {
      fail("LazyGit has no menu bar")
    }

    const menuBar = process.menuBars[0]
    if (menuBar.menuBarItems.whose({ name: "File" })().length < 1) {
      fail("LazyGit has no File menu")
    }
    if (menuBar.menuBarItems.whose({ name: "LazyGit" })().length < 1) {
      fail("LazyGit has no application menu")
    }

    return process
  }

  quitApp()

  try {
    openApp(shellQuote(documentPath))
    const process = assertLegitProcess()
    waitUntil("LazyGit did not present the document window", () => process.windows.length > 0)
    const windowName = process.windows[0].name()
    if (windowName !== "LazyGit - Sample Folder") {
      fail(`Expected LazyGit - Sample Folder document window but saw ${windowName}`)
    }

    delaySeconds(2)
    if (lazyGitProcesses().length < 1) {
      fail("LazyGit exited while opening sample-folder.lazygit")
    }

    quitApp()
    return `LazyGit smoke ok: ${appPath}`
  } catch (error) {
    quitApp()
    throw error
  }
}
