#!/usr/bin/osascript -l JavaScript
/// <reference types="@jxa/types" />
ObjC.import("Cocoa")
ObjC.import("WebKit")

// Create the main application
var app = Application.currentApplication()
app.includeStandardAdditions = true

// Create a new window
var window = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(
  $.NSMakeRect(0, 0, 800, 600),
  $.NSTitledWindowMask | $.NSClosableWindowMask | $.NSResizableWindowMask,
  $.NSBackingStoreBuffered,
  false,
)

// Configure the window
window.title = "WebView Window"
window.makeKeyAndOrderFront(null)

// Create a WebView and set it to fill the entire window
var webView = $.WKWebView.alloc.initWithFrame(window.contentView.bounds)
webView.autoresizingMask = $.NSViewWidthSizable | $.NSViewHeightSizable
window.contentView.addSubview(webView)

// Load a URL in the WebView
var url = $.NSURL.URLWithString("https://www.opdex.app/")
var request = $.NSURLRequest.requestWithURL(url)
webView.loadRequest(request)

// Define a function to execute JavaScript after the page loads
function executeJavaScript() {
  webView.evaluateJavaScriptCompletionHandler(
    "document.title",
    // $block("void, id, NSError*", ),
    (result, error) => {
      console.log("Executing JavaScript...")
      if (error !== null) {
        console.log("Error: " + error.localizedDescription)
      } else {
        console.log("Result: " + result)
      }
    },
  )
}

executeJavaScript()

// Delay the JavaScript execution to ensure the page has loaded
$.NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(3.0, false, executeJavaScript)

// Necessary to keep the application running
app.run

// https://stackoverflow.com/a/41087510
function timer(repeats, func, delay) {
  const args = Array.prototype.slice.call(arguments, 2, -1)
  args.unshift(this)
  const boundFunc = func.bind.apply(func, args)
  const operation = $.NSBlockOperation.blockOperationWithBlock(boundFunc)
  const timer = $.NSTimer.timerWithTimeIntervalTargetSelectorUserInfoRepeats(delay / 1000, operation, "main", null, repeats)
  $.NSRunLoop.currentRunLoop.addTimerForMode(timer, "timer")
  return timer
}

function invalidate(timeoutID) {
  timeoutID.invalidate
}

const setTimeout = timer.bind(undefined, false)
const setInterval = timer.bind(undefined, true)
const clearTimeout = invalidate
const clearInterval = invalidate

setTimeout(() => {
  console.log(123)
}, 1234)

$.NSRunLoop.currentRunLoop.runModeBeforeDate("timer", $.NSDate.distantFuture)

function quit() {
  console.log("quitting...")
}
