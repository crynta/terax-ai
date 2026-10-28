import Cocoa
import ObjectiveC
import WebKit

// Minimal WKWebView host for scripts/ghostty-webkit-memory.mjs. It loads one HTML
// file, prints every message the page posts together with the WebContent process
// id (so the orchestrator can measure that process), and exits on "DONE".

func webProcessIdentifier(_ object: NSObject) -> Int32 {
  let selector = Selector("_webProcessIdentifier")
  guard object.responds(to: selector),
    let method = class_getInstanceMethod(type(of: object), selector)
  else { return 0 }
  typealias Function = @convention(c) (AnyObject, Selector) -> Int32
  return unsafeBitCast(method_getImplementation(method), to: Function.self)(object, selector)
}

final class Delegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
  var web: WKWebView!
  var window: NSWindow!

  func applicationDidFinishLaunching(_ notification: Notification) {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    config.userContentController.add(self, name: "out")
    web = WKWebView(frame: NSRect(x: 0, y: 0, width: 400, height: 300), configuration: config)
    window = NSWindow(
      contentRect: web.frame, styleMask: [.titled], backing: .buffered, defer: false)
    window.contentView = web
    window.orderFrontRegardless()
    let html = try! String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
    web.loadHTMLString(html, baseURL: URL(string: "https://terax.test/"))
  }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    print("\(message.body) pid=\(webProcessIdentifier(web))")
    fflush(stdout)
    if "\(message.body)".hasPrefix("DONE") { NSApp.terminate(nil) }
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = Delegate()
app.delegate = delegate
app.run()
