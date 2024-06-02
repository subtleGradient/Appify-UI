import SwiftUI

@main
struct Appify_UI_23App: App {
  var body: some Scene {
    WindowGroup {
      ContentWebView(
        url: parseCommandLine(CommandLine.arguments) ?? Bundle.main.url(
          forResource: "index", withExtension: "html") ?? URL(
            string: "https://opdex.app/")!
      )
      .onAppear {
        compileAndExecuteJXA(named: "main")
      }
      .onDisappear {
        compileAndExecuteJXA(named: "cleanup")
      }
    }
  }
}
