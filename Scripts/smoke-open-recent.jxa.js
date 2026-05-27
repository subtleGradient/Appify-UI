#!/usr/bin/env -S osascript -l JavaScript

function run(argv) {
  if (argv.length < 4) {
    throw new Error("usage: smoke-open-recent.jxa.js APP_PATH BUNDLE_IDENTIFIER DOCUMENT_PATH EXPECTED_TITLE [APP_NAME]");
  }

  const appPath = argv[0];
  const expectedBundleIdentifier = argv[1];
  const documentPath = argv[2];
  const expectedTitle = argv[3];
  const appName = argv[4] || expectedTitle;

  const app = Application.currentApplication();
  app.includeStandardAdditions = true;
  const systemEvents = Application("System Events");

  const shellQuote = value => `'${String(value).replace(/'/g, "'\\''")}'`;
  const delaySeconds = seconds => delay(seconds);
  const bundleProcesses = () => {
    try {
      return systemEvents.processes.whose({ bundleIdentifier: expectedBundleIdentifier })();
    } catch (_) {
      return [];
    }
  };
  const namedProcesses = name => {
    try {
      return systemEvents.processes.whose({ name })();
    } catch (_) {
      return [];
    }
  };
  const candidateProcesses = () => {
    const seen = {};
    const result = [];
    for (const processes of [bundleProcesses(), namedProcesses(appName), namedProcesses("appify-host")]) {
      for (let index = 0; index < processes.length; index++) {
        const process = processes[index];
        try {
          const pid = String(process.unixId());
          if (!seen[pid]) {
            seen[pid] = true;
            result.push(process);
          }
        } catch (_) {}
      }
    }
    return result;
  };
  const matchingProcess = () => {
    const processes = candidateProcesses();
    for (let index = 0; index < processes.length; index++) {
      const process = processes[index];
      try {
        if (process.menuBars.length >= 1) return process;
      } catch (_) {}
    }
    return processes[0];
  };
  const waitUntil = (message, predicate) => {
    const deadline = Date.now() + 45000;
    while (Date.now() <= deadline) {
      const value = predicate();
      if (value) return value;
      delaySeconds(0.1);
    }
    throw new Error(message);
  };
  const quitApp = () => {
    try {
      Application(expectedBundleIdentifier).quit();
      delaySeconds(0.3);
    } catch (_) {}
    try {
      Application("appify-host").quit();
      delaySeconds(0.3);
    } catch (_) {}
    try {
      const pids = bundleProcesses().map(process => process.unixId()).join(" ");
      if (pids) app.doShellScript(`kill ${pids}`);
    } catch (_) {}
  };

  quitApp();

  let observedMenuItemNames = [];

  try {
    app.doShellScript(`open -n -a ${shellQuote(appPath)} ${shellQuote(documentPath)}`);
    waitUntil(`${appName} process did not appear`, () => matchingProcess());
    try {
      matchingProcess().frontmost = true;
    } catch (_) {}

    const menuBar = waitUntil(`${appName} has no menu bar`, () => {
      try {
        const process = matchingProcess();
        if (!process) return null;
        return process.menuBars.length >= 1 ? process.menuBars[0] : null;
      } catch (_) {
        return null;
      }
    });

    const openRecentMenu = waitUntil(`${appName} has no Open Recent menu`, () => {
      try {
        return menuBar.menuBarItems.byName("File").menus[0].menuItems.byName("Open Recent").menus[0];
      } catch (_) {
        return null;
      }
    });

    const menuItemNames = waitUntil(`Open Recent did not include ${expectedTitle}`, () => {
      try {
        const items = openRecentMenu.menuItems();
        const names = [];
        for (let index = 0; index < items.length; index++) {
          const name = items[index].name();
          if (name !== null && name !== undefined) {
            names.push(String(name));
          }
        }
        observedMenuItemNames = names;
        return names.indexOf(expectedTitle) >= 0 ? names : null;
      } catch (_) {
        return null;
      }
    });

    quitApp();
    return `Open Recent smoke ok: ${menuItemNames.join(", ")}`;
  } catch (error) {
    quitApp();
    if (typeof observedMenuItemNames !== "undefined" && observedMenuItemNames.length > 0) {
      throw new Error(`${error.message}; observed Open Recent items: ${observedMenuItemNames.join(", ")}`);
    }
    throw error;
  }
}
