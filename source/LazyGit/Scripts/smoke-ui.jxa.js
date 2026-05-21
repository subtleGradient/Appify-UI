#!/usr/bin/env -S osascript -l JavaScript

function run(argv) {
  const appPath = argv[0]
  const expectedBundleIdentifier = argv[1]
  const documentPath = argv[2]
  const app = Application.currentApplication()
  app.includeStandardAdditions = true

  const systemEvents = Application("System Events")
  const deadline = Date.now() + 20000

  const shellQuote = value => `'${String(value).replace(/'/g, "'\\''")}'`
  const delaySeconds = seconds => delay(seconds)
  const bundleProcesses = () => {
    try {
      return systemEvents.processes.whose({ bundleIdentifier: expectedBundleIdentifier })()
    } catch (_) {
      return []
    }
  }
  const lazyGitProcesses = () => {
    const bundled = bundleProcesses()
    if (bundled.length > 0) return bundled
    return systemEvents.processes.whose({ name: "LazyGit" })()
  }
  const matchingLazyGitProcesses = () => {
    const processes = lazyGitProcesses()
    const result = []
    for (let index = 0; index < processes.length; index++) {
      const process = processes[index]
      try {
        if (process.bundleIdentifier() === expectedBundleIdentifier) {
          result.push(process)
        }
      } catch (_) {}
    }
    return result
  }
  const matchingLazyGitProcess = () => matchingLazyGitProcesses()[0]
  const processWithWindow = expectedWindowName => {
    const processes = matchingLazyGitProcesses()
    for (let index = 0; index < processes.length; index++) {
      const process = processes[index]
      try {
        const windows = process.windows.whose({ name: expectedWindowName })()
        if (windows.length > 0) return process
      } catch (_) {}
    }
    return null
  }
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
    const process = waitUntil("LazyGit process did not appear", () => matchingLazyGitProcess())
    try {
      process.frontmost = true
    } catch (_) {}

    const bundleIdentifier = process.bundleIdentifier()
    if (bundleIdentifier !== expectedBundleIdentifier) {
      fail(`Expected bundle identifier ${expectedBundleIdentifier} but saw ${bundleIdentifier}`)
    }

    return process
  }
  const assertMenus = process => {
    const menuBar = waitUntil("LazyGit has no menu bar", () => {
      try {
        return process.menuBars.length >= 1 ? process.menuBars[0] : null
      } catch (_) {
        return null
      }
    })
    waitUntil("LazyGit has no File menu", () => {
      try {
        return menuBar.menuBarItems.whose({ name: "File" })().length >= 1
      } catch (_) {
        return false
      }
    })
    waitUntil("LazyGit has no application menu", () => {
      try {
        return menuBar.menuBarItems.whose({ name: "LazyGit" })().length >= 1
      } catch (_) {
        return false
      }
    })
  }

  quitApp()

  try {
    const expectedWindowName = "LazyGit - Sample Folder"
    openApp(shellQuote(documentPath))
    assertLegitProcess()
    const process = waitUntil(
      "LazyGit did not present the sample document window",
      () => processWithWindow(expectedWindowName)
    )
    assertMenus(process)

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
