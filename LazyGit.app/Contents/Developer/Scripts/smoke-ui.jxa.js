#!/usr/bin/env -S osascript -l JavaScript

function run(argv) {
  const appPath = argv[0]
  const expectedBundleIdentifier = argv[1]
  const documentPath = argv[2]
  const app = Application.currentApplication()
  app.includeStandardAdditions = true

  const systemEvents = Application("System Events")

  const shellQuote = value => `'${String(value).replace(/'/g, "'\\''")}'`
  const delaySeconds = seconds => delay(seconds)
  const bundleProcesses = () => {
    try {
      return systemEvents.processes.whose({ bundleIdentifier: expectedBundleIdentifier })()
    } catch (_) {
      return []
    }
  }
  const namedProcesses = name => {
    try {
      return systemEvents.processes.whose({ name })()
    } catch (_) {
      return []
    }
  }
  const lazyGitProcesses = () => {
    const seen = {}
    const result = []
    for (const processes of [bundleProcesses(), namedProcesses("LazyGit"), namedProcesses("appify-host")]) {
      for (let index = 0; index < processes.length; index++) {
        const process = processes[index]
        try {
          const pid = String(process.unixId())
          if (!seen[pid]) {
            seen[pid] = true
            result.push(process)
          }
        } catch (_) {}
      }
    }
    return result
  }
  const matchingLazyGitProcesses = () => {
    const processes = lazyGitProcesses()
    const result = []
    for (let index = 0; index < processes.length; index++) {
      const process = processes[index]
      try {
        if (process.bundleIdentifier() === expectedBundleIdentifier) {
          result.push(process)
          continue
        }
      } catch (_) {}
      result.push(process)
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
  const describeWindows = () => {
    const processes = matchingLazyGitProcesses()
    const descriptions = []
    for (let processIndex = 0; processIndex < processes.length; processIndex++) {
      const process = processes[processIndex]
      try {
        const windows = process.windows()
        const names = []
        for (let windowIndex = 0; windowIndex < windows.length; windowIndex++) {
          try {
            names.push(windows[windowIndex].name())
          } catch (_) {
            names.push("<unnamed>")
          }
        }
        descriptions.push(`${process.name()}[${process.unixId()}]: ${names.join(", ") || "<no windows>"}`)
      } catch (_) {}
    }
    return descriptions.join(" | ") || "<no matching processes>"
  }
  const fail = message => {
    throw new Error(message)
  }
  const waitUntil = (message, predicate, timeoutMilliseconds) => {
    const deadline = Date.now() + (timeoutMilliseconds || 45000)
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
    try {
      Application("appify-host").quit()
      delaySeconds(0.5)
    } catch (_) {}
  }
  const openApp = extraArguments => {
    if (extraArguments) {
      app.doShellScript(`open -n -a ${shellQuote(appPath)} ${extraArguments}`)
    } else {
      app.doShellScript(`open -n ${shellQuote(appPath)}`)
    }
  }
  const assertLegitProcess = () => {
    const process = waitUntil("LazyGit process did not appear", () => matchingLazyGitProcess())
    try {
      process.frontmost = true
    } catch (_) {}

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
    for (const menuName of ["File", "Edit", "View", "Window", "Help"]) {
      waitUntil(`LazyGit has no ${menuName} menu`, () => {
        try {
          return menuBar.menuBarItems.whose({ name: menuName })().length >= 1
        } catch (_) {
          return false
        }
      })
    }
    waitUntil("LazyGit has no application menu", () => {
      try {
        return menuBar.menuBarItems.whose({ name: "LazyGit" })().length >= 1
      } catch (_) {
        return false
      }
    })
  }
  const closeDocumentWindow = expectedWindowName => {
    const deadline = Date.now() + 10000
    let attemptedCommandW = false
    while (Date.now() <= deadline) {
      const process = processWithWindow(expectedWindowName)
      if (process === null) return

      try {
        process.frontmost = true
      } catch (_) {}

      try {
        const window = process.windows.whose({ name: expectedWindowName })()[0]
        try {
          window.actions.whose({ name: "AXRaise" })()[0].perform()
        } catch (_) {}
        try {
          window.buttons[0].click()
        } catch (_) {}
      } catch (_) {}

      if (!attemptedCommandW) {
        try {
          systemEvents.keystroke("w", { using: "command down" })
        } catch (_) {}
        attemptedCommandW = true
      }

      delaySeconds(0.2)
    }

    fail(`LazyGit document window did not close; windows: ${describeWindows()}`)
  }

  quitApp()

  try {
    const expectedWindowName = "LazyGit - Sample Folder"
    openApp(shellQuote(documentPath))
    const process = waitUntil(
      "LazyGit did not present the sample document window",
      () => processWithWindow(expectedWindowName)
    )
    assertMenus(process)

    delaySeconds(2)
    if (lazyGitProcesses().length < 1) {
      fail("LazyGit exited while opening sample-folder.lazygit")
    }

    closeDocumentWindow(expectedWindowName)
    waitUntil(
      `LazyGit document window did not close; windows: ${describeWindows()}`,
      () => processWithWindow(expectedWindowName) === null,
      10000
    )
    delaySeconds(1)
    return `LazyGit smoke ok: ${appPath}`
  } catch (error) {
    quitApp()
    throw error
  }
}
