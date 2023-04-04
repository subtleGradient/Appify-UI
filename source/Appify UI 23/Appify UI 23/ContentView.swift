import SwiftUI
import WebKit

import SwiftUI
import WebKit

struct WebView: NSViewRepresentable {

    let url: URL

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeNSView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.navigationDelegate = context.coordinator
        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
        nsView.load(URLRequest(url: url))
    }

    class Coordinator: NSObject, WKNavigationDelegate {
        var parent: WebView

        init(_ parent: WebView) {
            self.parent = parent
        }
    }
}

struct ContentView: View {
    let url: URL

    var body: some View {
        WebView(url: url)
            .frame(minWidth: 200, minHeight: 100)
            .edgesIgnoringSafeArea(.all)
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView(url: URL(string: "https://double.observer/")!)
    }
}
