import SwiftUI

@main
struct Appify_UI_23App: App {
    var body: some Scene {
        WindowGroup {
            let specifiedURL = parseCommandLine(CommandLine.arguments)
            let defaultURL = Bundle.main.url(forResource: "index", withExtension: "html") ?? URL(string: "https://double.observer/")!
            let url = specifiedURL ?? defaultURL
            ContentWebView(url: url)
        }
    }
}
