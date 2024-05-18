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
  }

  func applicationWillTerminate(_ aNotification: Notification) {
    // Insert code here to tear down your application
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    return true
  }
}
