import SwiftUI

@main
struct Appify_UI_23App: App {
  var body: some Scene {
    WindowGroup {
      let specifiedURL = parseCommandLine(CommandLine.arguments)
      let defaultURL =
        Bundle.main.url(forResource: "index", withExtension: "html") ?? URL(
          string: "https://opdex.app/")!
      let url = specifiedURL ?? defaultURL
      ContentWebView(url: url)
        .onAppear {
          // Execute compileAndExecuteJXA asynchronously on appear
          DispatchQueue.global(qos: .background).async {
            compileAndExecuteJXA(named: "main")
          }
        }
    }
  }
}
