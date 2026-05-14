import Foundation

enum AppifyHTML {
    static func statusPage(title: String, message: String) -> String {
        page(accent: "#2563eb", title: title, message: message)
    }

    static func errorPage(title: String, message: String) -> String {
        page(accent: "#b42318", title: title, message: message)
    }

    private static func page(accent: String, title: String, message: String) -> String {
        """
        <!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <meta name="color-scheme" content="light dark">
            <title>\(escape(title))</title>
            <style>
              :root { color-scheme: light dark; }
              html, body { height: 100%; }
              body {
                align-items: center;
                background: Canvas;
                color: CanvasText;
                display: grid;
                font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                margin: 0;
                padding: 32px;
              }
              main {
                border-left: 4px solid \(accent);
                max-width: 680px;
                padding-left: 20px;
              }
              h1 {
                font-size: 24px;
                font-weight: 650;
                letter-spacing: 0;
                line-height: 1.15;
                margin: 0 0 10px;
              }
              p {
                color: color-mix(in oklch, CanvasText 72%, transparent);
                font-size: 14px;
                margin: 0;
                white-space: pre-wrap;
              }
            </style>
          </head>
          <body>
            <main>
              <h1>\(escape(title))</h1>
              <p>\(escape(message))</p>
            </main>
          </body>
        </html>
        """
    }

    private static func escape(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
}
