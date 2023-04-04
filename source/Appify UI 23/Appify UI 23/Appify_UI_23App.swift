import SwiftUI

func showHelpMessage() {
    let helpMessage = """
    Usage: Appify_UI_23 [OPTIONS]

    Options:
      -u, --url <url>       Start the web browser with the specified URL. If not
                            specified, the default URL is the local index.html.
      -h, --help            Show this help message and exit.
    """

    print(helpMessage)
}

func parseCommandLine(_ arguments: [String]) -> URL? {
    var specifiedURL: URL?
    var skipNext = false
    loop: for i in 1..<(arguments.count) {
        if skipNext {
            skipNext = false
            continue
        }
        
        let arg = arguments[i]

        switch arg {
        case "-h", "--help":
            showHelpMessage()
            NSApp.terminate(nil)

        case "-u", "--url":
            let nextIndex = i + 1
            if nextIndex < arguments.count,
               let url = URL(string: arguments[nextIndex]) {
                specifiedURL = url
                skipNext = true
            }

        default:
            break loop
        }
    }

    return specifiedURL
}

@main
struct Appify_UI_23App: App {
    var body: some Scene {
        WindowGroup {
            let specifiedURL = parseCommandLine(CommandLine.arguments)
            let defaultURL = Bundle.main.url(forResource: "index", withExtension: "html") ?? URL(string: "https://double.observer/")!
            let url = specifiedURL ?? defaultURL
            ContentView(url: url)
        }
    }
}
