import SwiftUI

@main
struct Appify_UI_23App: App {
  var body: some Scene {
    WindowGroup {
      // Execute compileAndExecuteJXA asynchronously
      let _ = DispatchQueue.global(qos: .background).async {
        compileAndExecuteJXA(named: "main")
      }

      let specifiedURL = parseCommandLine(CommandLine.arguments)
      let defaultURL =
        Bundle.main.url(forResource: "index", withExtension: "html") ?? URL(
          string: "https://opdex.app/")!
      let url = specifiedURL ?? defaultURL
      ContentWebView(url: url)
    }
  }
}
