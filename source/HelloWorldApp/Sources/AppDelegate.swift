import Cocoa

// @NSApplicationMain
class AppDelegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) {
    setupMenuBar()
    createWindow()
  }
  func applicationWillTerminate(_ notification: Notification) {
    // Handle termination
  }
  func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
    return true
  }

  @objc func newWindow(_ sender: Any?) {
    createWindow()
  }
  func createWindow() {
    let window = NSWindow(
      contentRect: NSMakeRect(0, 0, 800, 600),
      styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false
    )
    window.center()
    window.title = "New Window"
    window.makeKeyAndOrderFront(nil)
  }

  func setupMenuBar() {
    let mainMenu = NSMenu()
    NSApp.mainMenu = mainMenu

    let appMenuItem = NSMenuItem()
    mainMenu.addItem(appMenuItem)

    let appMenu = NSMenu()
    let appName = ProcessInfo.processInfo.processName
    let quitTitle = "Quit \(appName)"
    let quitMenuItem = NSMenuItem(
      title: quitTitle, action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appMenu.addItem(quitMenuItem)
    appMenuItem.submenu = appMenu

    let fileMenuItem = NSMenuItem()
    mainMenu.addItem(fileMenuItem)

    let fileMenu = NSMenu(title: "File")
    let closeMenuItem = NSMenuItem(
      title: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    fileMenu.addItem(closeMenuItem)
    fileMenuItem.submenu = fileMenu

    // let newItem = fileMenu.addItem(
    //   withTitle: "New Window", action: #selector(newWindow(_:)), keyEquivalent: "n")
    // newItem.keyEquivalentModifierMask = [.command]
  }
}
