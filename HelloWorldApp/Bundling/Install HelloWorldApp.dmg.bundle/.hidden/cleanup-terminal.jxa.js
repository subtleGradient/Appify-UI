#!/usr/bin/osascript -l JavaScript

const Terminal = Application("Terminal")

if (Terminal.windows.length === 1) {
  const thisWindow = Terminal.windows[0]
  if (thisWindow?.tabs().length === 1) {
    thisWindow?.close() // this is fine because we know there is only one tab
    Terminal.quit() // this is fine because we know there is only one window
  }
}
