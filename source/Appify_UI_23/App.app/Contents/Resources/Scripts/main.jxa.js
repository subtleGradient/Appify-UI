#!/usr/bin/osascript -l JavaScript
/// <reference types="@jxa/global-type" />
/// <reference types="@jxa/types" />
ObjC.import("Cocoa")
ObjC.import("WebKit")

// Create the main application
var app = Application.currentApplication()
app.includeStandardAdditions = true

// Create a new uiWindow
var uiWindow = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(
  $.NSMakeRect(0, 0, 800, 600),
  $.NSTitledWindowMask | $.NSClosableWindowMask | $.NSResizableWindowMask,
  $.NSBackingStoreBuffered,
  false,
)

// Configure the uiWindow
uiWindow.title = "WebView Window"
uiWindow.center
uiWindow.makeKeyAndOrderFront(null)

// Create a WebView and set it to fill the entire uiWindow
var webView = $.WKWebView.alloc.initWithFrame(uiWindow.contentView.bounds)
webView.autoresizingMask = $.NSViewWidthSizable | $.NSViewHeightSizable
uiWindow.contentView.addSubview(webView)

// Load a URL in the WebView
var url = $.NSURL.URLWithString("https://www.opdex.app/")
var request = $.NSURLRequest.requestWithURL(url)
webView.loadRequest(request)

{
  // based on the code here: https://stackoverflow.com/a/41087510
  function setTimeoutOrInterval(/**@type boolean*/ isRepeating, /** @type Function*/ callback, delay) {
    const boundFunc = callback.bind(null)
    const operation = $.NSBlockOperation.blockOperationWithBlock(boundFunc)
    const timer = $.NSTimer.timerWithTimeIntervalTargetSelectorUserInfoRepeats(
      delay / 1000,
      operation,
      "main",
      null,
      isRepeating,
    )
    $.NSRunLoop.currentRunLoop.addTimerForMode(timer, "timer")
    return timer
  }

  function invalidate(timeoutID) {
    timeoutID.invalidate
  }

  Object.assign(this, {
    setTimeout: setTimeoutOrInterval.bind(undefined, false),
    setInterval: setTimeoutOrInterval.bind(undefined, true),
    clearTimeout: invalidate,
    clearInterval: invalidate,
  })

  // setTimeout(() => {
  //   console.log(123)
  // }, 1234)

  $.NSRunLoop.currentRunLoop.runModeBeforeDate("timer", $.NSDate.distantFuture)
}
