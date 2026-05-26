#!/usr/bin/env -S osascript -l JavaScript

function run(argv) {
  const appPath = argv[0]
  const expectedBundleIdentifier = argv[1]
  const appName = argv[2] || "litecli"
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
  const candidateProcesses = () => {
    const seen = {}
    const result = []
    for (const processes of [bundleProcesses(), namedProcesses(appName), namedProcesses("appify-host")]) {
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
  const matchingProcess = () => {
    const processes = candidateProcesses()
    for (let index = 0; index < processes.length; index++) {
      const process = processes[index]
      try {
        if (process.menuBars.length >= 1) return process
      } catch (_) {}
    }
    return processes[0]
  }
  const fail = message => {
    throw new Error(message)
  }
  const waitUntil = (message, predicate) => {
    const deadline = Date.now() + 45000
    while (Date.now() <= deadline) {
      const value = predicate()
      if (value) return value
      delaySeconds(0.1)
    }
    fail(message)
  }
  const quitApp = () => {
    try {
      const processes = bundleProcesses()
      for (let processIndex = 0; processIndex < processes.length; processIndex++) {
        const windows = processes[processIndex].windows()
        for (let windowIndex = 0; windowIndex < windows.length; windowIndex++) {
          try {
            const cancelButtons = windows[windowIndex].buttons.whose({ name: "Cancel" })()
            if (cancelButtons.length > 0) cancelButtons[0].click()
          } catch (_) {}
        }
      }
      delaySeconds(0.2)
    } catch (_) {}
    try {
      Application(expectedBundleIdentifier).quit()
      delaySeconds(0.2)
    } catch (_) {}
    try {
      Application("appify-host").quit()
      delaySeconds(0.5)
    } catch (_) {}
    try {
      const pids = bundleProcesses().map(process => process.unixId()).join(" ")
      if (pids) app.doShellScript(`kill ${pids}`)
    } catch (_) {}
  }

  quitApp()

  try {
    app.doShellScript(`open -n ${shellQuote(appPath)}`)
    waitUntil(`${appName} process did not appear`, () => matchingProcess())
    try {
      matchingProcess().frontmost = true
    } catch (_) {}
    const menuBar = waitUntil(`${appName} has no menu bar`, () => {
      try {
        const process = matchingProcess()
        if (!process) return null
        return process.menuBars.length >= 1 ? process.menuBars[0] : null
      } catch (_) {
        return null
      }
    })

    waitUntil(`${appName} has no application menu`, () => {
      try {
        const process = matchingProcess()
        return process && process.menuBars[0].menuBarItems.length >= 6
      } catch (_) {
        return false
      }
    })

    for (const menuName of ["File", "Edit", "View", "Window", "Help"]) {
      waitUntil(`${appName} has no ${menuName} menu`, () => {
        try {
          return menuBar.menuBarItems.whose({ name: menuName })().length >= 1
        } catch (_) {
          return false
        }
      })
    }

    quitApp()
    return `${appName} menu smoke ok: ${appPath}`
  } catch (error) {
    quitApp()
    throw error
  }
}
