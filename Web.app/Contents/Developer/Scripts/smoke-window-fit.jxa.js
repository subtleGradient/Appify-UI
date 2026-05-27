#!/usr/bin/env -S osascript -l JavaScript

function run(argv) {
  if (argv.length < 3) {
    throw new Error("usage: smoke-window-fit.jxa.js APP_PATH BUNDLE_IDENTIFIER DOCUMENT_PATH [first-fit|zoom-obedience|zoom-height-obedience]");
  }

  const appPath = argv[0];
  const expectedBundleIdentifier = argv[1];
  const documentPath = argv[2];
  const mode = argv[3] || "first-fit";
  const expectedWindowName = documentPath.split("/").pop();
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
    for (const processes of [bundleProcesses(), namedProcesses("Web"), namedProcesses("appify-host")]) {
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
  const windowNameMatches = name => String(name || "").startsWith(expectedWindowName);
  const processWithWindow = () => {
    const processes = candidateProcesses();
    for (let index = 0; index < processes.length; index++) {
      const process = processes[index];
      try {
        const windows = process.windows();
        for (let windowIndex = 0; windowIndex < windows.length; windowIndex++) {
          if (windowNameMatches(windows[windowIndex].name())) return process;
        }
      } catch (_) {}
    }
    return null;
  };
  const windowByName = () => {
    const process = processWithWindow();
    if (!process) return null;
    try {
      const windows = process.windows();
      for (let index = 0; index < windows.length; index++) {
        if (windowNameMatches(windows[index].name())) return windows[index];
      }
      return null;
    } catch (_) {
      return null;
    }
  };
  const waitUntil = (message, predicate, timeoutMilliseconds) => {
    const deadline = Date.now() + (timeoutMilliseconds || 45000);
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
  };
  const windowFrameAutosaveName = () => {
    const encodedPath = app.doShellScript(
      `/usr/bin/python3 -c 'import base64,sys; print(base64.b64encode(sys.argv[1].encode()).decode().replace("+","-").replace("/","_").rstrip("="))' ${shellQuote(documentPath)}`
    );
    return `AppifyHost.DocumentWindow.${expectedBundleIdentifier}.${encodedPath}`;
  };
  const clearSavedFrame = () => {
    const autosaveName = windowFrameAutosaveName();
    for (const domain of [expectedBundleIdentifier, "appify-host"]) {
      app.doShellScript(`/usr/bin/defaults delete ${shellQuote(domain)} ${shellQuote(`NSWindow Frame ${autosaveName}`)} >/dev/null 2>&1 || true`);
    }
  };
  const writeSavedFrame = frameString => {
    const autosaveName = windowFrameAutosaveName();
    for (const domain of [expectedBundleIdentifier, "appify-host"]) {
      app.doShellScript(`/usr/bin/defaults write ${shellQuote(domain)} ${shellQuote(`NSWindow Frame ${autosaveName}`)} ${shellQuote(frameString)}`);
    }
  };
  const windowSize = window => {
    const size = window.size();
    return { width: Number(size[0]), height: Number(size[1]) };
  };
  const clickZoom = () => {
    const process = processWithWindow();
    if (!process) throw new Error(`Could not find process for ${expectedWindowName}`);
    process.frontmost = true;
    delaySeconds(0.2);
    process.menuBars[0].menuBarItems.byName("Window").menus[0].menuItems.byName("Zoom").click();
  };
  const isMeaningfulResize = (before, after) => {
    const widthDelta = Math.abs(after.width - before.width);
    const heightDelta = Math.abs(after.height - before.height);
    const beforeArea = Math.max(1, before.width * before.height);
    const afterArea = Math.max(1, after.width * after.height);
    return widthDelta >= 80 || heightDelta >= 80 || Math.abs(afterArea - beforeArea) / beforeArea >= 0.12;
  };
  const visibleScrollBarCount = window => {
    try {
      const scrollAreas = window.scrollAreas();
      let count = 0;
      for (let areaIndex = 0; areaIndex < scrollAreas.length; areaIndex++) {
        try {
          count += scrollAreas[areaIndex].scrollBars().length;
        } catch (_) {}
      }
      return count;
    } catch (_) {
      return 0;
    }
  };

  quitApp();
  clearSavedFrame();
  if (mode === "zoom-obedience") {
    writeSavedFrame("20 48 1480 780 0 0 4096 2304 ");
  } else if (mode === "zoom-height-obedience") {
    writeSavedFrame("0 48 4096 620 0 0 4096 2304 ");
  }

  try {
    app.doShellScript(`open -n -a ${shellQuote(appPath)} ${shellQuote(documentPath)}`);
    const window = waitUntil(`Web did not present ${expectedWindowName}`, () => windowByName());

    if (mode === "zoom-obedience") {
      waitUntil(
        `${expectedWindowName} did not become ready for Zoom smoke`,
        () => {
          const size = windowSize(window);
          return size.width > 600 && size.height > 400 ? size : null;
        },
        15000
      );
      const before = waitUntil(
        `${expectedWindowName} could not be forced to an awkward large frame`,
        () => {
          const size = windowSize(window);
          return size.width >= 1200 ? size : null;
        },
        3000
      );
      clickZoom();
      const after = waitUntil(
        `${expectedWindowName} Zoom did not produce a meaningful resize`,
        () => {
          const size = windowSize(window);
          return isMeaningfulResize(before, size) ? size : null;
        },
        8000
      );
      if (before.width >= 1100 && after.width >= before.width - 80) {
        throw new Error(`${expectedWindowName} Zoom did not obey the large-window shrink intent`);
      }

      quitApp();
      return `Web window Zoom smoke ok: ${Math.round(before.width)}x${Math.round(before.height)} -> ${Math.round(after.width)}x${Math.round(after.height)}`;
    }

    if (mode === "zoom-height-obedience") {
      waitUntil(
        `${expectedWindowName} did not become ready for height Zoom smoke`,
        () => {
          const size = windowSize(window);
          return size.width > 600 && size.height > 400 ? size : null;
        },
        15000
      );
      const before = waitUntil(
        `${expectedWindowName} could not be forced to a wide short frame`,
        () => {
          const size = windowSize(window);
          return size.width >= 1200 && size.height <= 700 ? size : null;
        },
        3000
      );
      clickZoom();
      const after = waitUntil(
        `${expectedWindowName} Zoom did not expand height meaningfully`,
        () => {
          const size = windowSize(window);
          return size.height >= before.height + 80 ? size : null;
        },
        8000
      );
      if (after.width > before.width + 40) {
        throw new Error(`${expectedWindowName} Zoom grew width when the height was the obvious missing axis`);
      }
      if (after.width < before.width - 80) {
        throw new Error(`${expectedWindowName} Zoom shrank width when the window was already at the screen edge`);
      }

      quitApp();
      return `Web window height Zoom smoke ok: ${Math.round(before.width)}x${Math.round(before.height)} -> ${Math.round(after.width)}x${Math.round(after.height)}`;
    }

    const fitted = waitUntil(
      `${expectedWindowName} did not fit to document content`,
      () => {
        const size = windowSize(window);
        return size.width > 620 && size.width < 920 && size.height > 720 ? size : null;
      },
      15000
    );
    const scrollBarCount = visibleScrollBarCount(window);
    if (scrollBarCount > 0) {
      throw new Error(`${expectedWindowName} still had visible scroll bars after fitting`);
    }

    quitApp();
    return `Web window fit smoke ok: ${Math.round(fitted.width)}x${Math.round(fitted.height)}`;
  } catch (error) {
    quitApp();
    throw error;
  }
}
