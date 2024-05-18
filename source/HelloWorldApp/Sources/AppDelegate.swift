import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate {
  var window: NSWindow!

  func applicationDidFinishLaunching(_ aNotification: Notification) {
    // Create the main application window
    let screenSize = NSScreen.main!.frame
    window = NSWindow(
      contentRect: NSRect(
        x: screenSize.midX - 200, y: screenSize.midY - 100, width: 400, height: 200),
      styleMask: [.titled, .closable, .resizable, .miniaturizable],
      backing: .buffered, defer: false)
    window.title = "HelloWorldApp"
    window.makeKeyAndOrderFront(nil)

    // Create a label and add it to the window
    let label = NSTextField(labelWithString: "Hello, world!")
    label.frame = NSRect(x: 100, y: 80, width: 200, height: 40)
    label.alignment = .center
    window.contentView?.addSubview(label)

    // Set up the menu bar
    setupMenuBar()
  }

  func applicationWillTerminate(_ aNotification: Notification) {
    // Insert code here to tear down your application
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    return true
  }

  func setupMenuBar() {
    let mainMenu = NSMenu()

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

    NSApp.mainMenu = mainMenu
  }
}
