import Cocoa
import ObjectiveC
import WebKit

// Native host for the isolated renderer lab.
//
// Channels to the orchestrator (run.py):
//   stdout  one JSON object per line. Page events ("phase"), native events ("native") and
//           sync events (page events with a "sync" id) are all emitted here.
//   stdin   "ack <id>" releases a pending sync request; EOF terminates the host. Only read when
//           TERAX_LAB_CONTROL=1, so running the executable by hand never exits on a closed stdin.
// Channels to the page:
//   messageHandlers.report   fire-and-forget (legacy default workload)
//   messageHandlers.native   request/response; implements window actions used by workloads
//
// Every page event is annotated with a "native" object (process ids, window state, counters),
// so the orchestrator never has to guess which WebKit helpers belong to this host.

func intCall(_ object: NSObject, _ name: String) -> Int32? {
  let selector = Selector(name)
  guard object.responds(to: selector), let method = class_getInstanceMethod(type(of: object), selector)
  else { return nil }
  typealias Function = @convention(c) (AnyObject, Selector) -> Int32
  return unsafeBitCast(method_getImplementation(method), to: Function.self)(object, selector)
}

func jsonString(_ object: Any) -> String {
  guard JSONSerialization.isValidJSONObject(object),
    let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
    let text = String(data: data, encoding: .utf8)
  else { return "{}" }
  return text
}

func uptimeMs() -> Double { Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000 }

final class Delegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler,
  WKScriptMessageHandlerWithReply, WKNavigationDelegate
{
  var window: NSWindow!
  var web: WKWebView!
  var cover: NSWindow?
  var pendingSync: [Int: (Any?, String?) -> Void] = [:]
  var counters: [String: Int] = [:]
  var activity: NSObjectProtocol?

  func count(_ key: String) { counters[key, default: 0] += 1 }

  func emit(_ object: [String: Any]) {
    print(jsonString(object))
    fflush(stdout)
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    // Process-scoped assertions (not system settings): keep the display awake so the idle
    // timer cannot lock the screen and occlude the benchmark window mid-run, and avoid App Nap
    // so the host's own timers stay accurate while its window is ordered out.
    activity = ProcessInfo.processInfo.beginActivity(
      options: [.userInitiated, .idleDisplaySleepDisabled, .idleSystemSleepDisabled],
      reason: "Terax renderer lab")
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    config.userContentController.add(self, name: "report")
    config.userContentController.addScriptMessageHandler(
      self, contentWorld: .page, name: "native")
    web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1000, height: 650), configuration: config)
    web.navigationDelegate = self
    window = NSWindow(
      contentRect: web.frame, styleMask: [.titled, .closable, .resizable, .miniaturizable],
      backing: .buffered, defer: false)
    window.title = "Terax Renderer Lab"
    window.contentView = web
    window.isReleasedWhenClosed = false
    window.center()
    observe()
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
    let url =
      CommandLine.arguments.count > 1
      ? CommandLine.arguments[1]
      : Bundle.main.object(forInfoDictionaryKey: "TeraxLabURL") as? String ?? "about:blank"
    web.load(URLRequest(url: URL(string: url)!))
    let environmentTimeout = Double(ProcessInfo.processInfo.environment["TERAX_LAB_TIMEOUT"] ?? "")
    let timeout = environmentTimeout ?? (CommandLine.arguments.count > 2 ? 600 : 120)
    DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { NSApp.terminate(nil) }
    if ProcessInfo.processInfo.environment["TERAX_LAB_CONTROL"] == "1" { startAckReader() }
  }

  // MARK: - Native events

  func observe() {
    let center = NotificationCenter.default
    center.addObserver(forName: NSWindow.didMoveNotification, object: window, queue: .main) {
      [weak self] _ in self?.count("didMove")
    }
    center.addObserver(forName: NSWindow.didResizeNotification, object: window, queue: .main) {
      [weak self] _ in self?.count("didResize")
    }
    center.addObserver(forName: NSWindow.didChangeScreenNotification, object: window, queue: .main)
    { [weak self] _ in self?.count("didChangeScreen") }
    center.addObserver(
      forName: NSWindow.didChangeBackingPropertiesNotification, object: window, queue: .main
    ) { [weak self] _ in self?.count("didChangeBackingProperties") }
    center.addObserver(
      forName: NSWindow.didChangeOcclusionStateNotification, object: window, queue: .main
    ) { [weak self] _ in
      guard let self else { return }
      self.count("occlusionChanges")
      self.emit([
        "native": "occlusion", "visible": self.window.occlusionState.contains(.visible),
        "uptimeMs": uptimeMs(),
      ])
    }
    for (name, label) in [
      (NSWindow.didBecomeKeyNotification, "didBecomeKey"),
      (NSWindow.didResignKeyNotification, "didResignKey"),
      (NSWindow.didMiniaturizeNotification, "didMiniaturize"),
      (NSWindow.didDeminiaturizeNotification, "didDeminiaturize"),
    ] {
      center.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in
        self?.count(label)
        self?.emit(["native": label, "uptimeMs": uptimeMs()])
      }
    }
    for (name, label) in [
      (NSApplication.didBecomeActiveNotification, "appActive"),
      (NSApplication.didResignActiveNotification, "appInactive"),
    ] {
      center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        self?.count(label)
        self?.emit(["native": label, "uptimeMs": uptimeMs()])
      }
    }
  }

  func isOccluded() -> Bool { !window.occlusionState.contains(.visible) }

  func nativeSnapshot() -> [String: Any] {
    var prewarmed: [Int] = []
    let pool = web.configuration.processPool
    let selector = Selector("_prewarmedProcessIdentifiersForTesting")
    if pool.responds(to: selector),
      let value = pool.perform(selector)?.takeUnretainedValue() as? [NSNumber]
    {
      prewarmed = value.map { $0.intValue }
    }
    let frame = window.frame
    return [
      "hostPid": Int(getpid()),
      "webContentPid": Int(intCall(web, "_webProcessIdentifier") ?? 0),
      "gpuPid": Int(intCall(web, "_gpuProcessIdentifier") ?? 0),
      "networkingPid": Int(intCall(web, "_networkProcessIdentifier") ?? 0),
      "prewarmedPids": prewarmed,
      "windowVisible": window.isVisible,
      "occlusionVisible": !isOccluded(),
      "key": window.isKeyWindow,
      "main": window.isMainWindow,
      "miniaturized": window.isMiniaturized,
      "appActive": NSApp.isActive,
      "scale": window.backingScaleFactor,
      "frame": [frame.origin.x, frame.origin.y, frame.size.width, frame.size.height],
      "screen": window.screen.map { [$0.frame.width, $0.frame.height] } ?? [],
      "counters": counters,
      "uptimeMs": uptimeMs(),
    ]
  }

  /// Parse the page event, attach native state and print it. Returns the event dictionary.
  @discardableResult
  func forward(_ text: String, sync: Int? = nil) -> [String: Any]? {
    guard let data = text.data(using: .utf8),
      var object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      print(text)
      fflush(stdout)
      return nil
    }
    object["native"] = nativeSnapshot()
    if let sync { object["sync"] = sync }
    print(jsonString(object))
    fflush(stdout)
    return object
  }

  // MARK: - Page messages

  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    guard let text = message.body as? String else { return }
    let event = forward(text)
    if event?["phase"] as? String == "done" {
      DispatchQueue.main.asyncAfter(deadline: .now() + 2) { NSApp.terminate(nil) }
    }
  }

  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage,
    replyHandler: @escaping (Any?, String?) -> Void
  ) {
    guard let body = message.body as? [String: Any], let command = body["cmd"] as? String else {
      replyHandler(nil, "Malformed native command")
      return
    }
    let reply: ([String: Any]) -> Void = { replyHandler(jsonString($0), nil) }
    switch command {
    case "sync":
      guard let id = body["id"] as? Int, let event = body["event"] as? String else {
        replyHandler(nil, "sync requires id and event")
        return
      }
      pendingSync[id] = { _, _ in reply(["ok": true]) }
      forward(event, sync: id)
    case "hide":
      hide(mode: body["mode"] as? String ?? "orderout", reply: reply)
    case "show":
      show(mode: body["mode"] as? String ?? "orderout", reply: reply)
    case "sleep":
      let ms = body["ms"] as? Double ?? 0
      DispatchQueue.main.asyncAfter(deadline: .now() + ms / 1000) { reply(["ok": true]) }
    case "moveSteps":
      moveSteps(
        dx: body["dx"] as? Double ?? 0, dy: body["dy"] as? Double ?? 0,
        count: body["count"] as? Int ?? 1, intervalMs: body["intervalMs"] as? Double ?? 16,
        reply: reply)
    case "resizeSteps":
      resizeSteps(
        dw: body["dw"] as? Double ?? 0, dh: body["dh"] as? Double ?? 0,
        count: body["count"] as? Int ?? 1, intervalMs: body["intervalMs"] as? Double ?? 16,
        live: body["live"] as? Bool ?? true, reply: reply)
    case "moveTo":
      let x = body["x"] as? Double ?? 0
      let y = body["y"] as? Double ?? 0
      window.setFrameOrigin(NSPoint(x: x, y: y))
      reply(["ok": true, "frame": nativeSnapshot()["frame"] ?? []])
    case "snapshot":
      reply(nativeSnapshot())
    case "gc":
      // WebKit's own full-collection request for every web process in this pool.
      let pool = web.configuration.processPool
      let selector = Selector("_garbageCollectJavaScriptObjectsForTesting")
      if pool.responds(to: selector) {
        _ = pool.perform(selector)
        reply(["ok": true, "method": "WKProcessPool._garbageCollectJavaScriptObjectsForTesting"])
      } else {
        reply(["ok": false, "method": "unavailable"])
      }
    default:
      replyHandler(nil, "Unknown native command \(command)")
    }
  }

  // MARK: - Window actions

  func waitFor(
    _ condition: @escaping () -> Bool, timeoutMs: Double, done: @escaping (Bool, Double) -> Void
  ) {
    let start = uptimeMs()
    func poll() {
      if condition() {
        done(true, uptimeMs() - start)
      } else if uptimeMs() - start > timeoutMs {
        done(false, uptimeMs() - start)
      } else {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.01) { poll() }
      }
    }
    poll()
  }

  func coverWindow() -> NSWindow {
    if let cover { return cover }
    let created = NSWindow(
      contentRect: window.frame.insetBy(dx: -40, dy: -40), styleMask: [.borderless],
      backing: .buffered, defer: false)
    created.backgroundColor = .black
    created.isOpaque = true
    created.hasShadow = false
    created.level = .floating
    created.ignoresMouseEvents = true
    created.isReleasedWhenClosed = false
    cover = created
    return created
  }

  func hide(mode: String, reply: @escaping ([String: Any]) -> Void) {
    switch mode {
    case "orderout": window.orderOut(nil)
    case "miniaturize": window.miniaturize(nil)
    case "cover":
      let overlay = coverWindow()
      overlay.setFrame(window.frame.insetBy(dx: -40, dy: -40), display: true)
      overlay.orderFrontRegardless()
    default:
      reply(["ok": false, "error": "unknown occlusion mode \(mode)"])
      return
    }
    waitFor({ self.isOccluded() }, timeoutMs: 4000) { ok, ms in
      reply(["ok": ok, "occluded": self.isOccluded(), "ms": ms, "mode": mode])
    }
  }

  func show(mode: String, reply: @escaping ([String: Any]) -> Void) {
    switch mode {
    case "miniaturize": window.deminiaturize(nil)
    case "cover":
      cover?.orderOut(nil)
      window.makeKeyAndOrderFront(nil)
    default: window.makeKeyAndOrderFront(nil)
    }
    NSApp.activate(ignoringOtherApps: true)
    window.makeFirstResponder(web)
    var attempts = 0
    waitFor(
      {
        let ready = !self.isOccluded() && self.window.isKeyWindow && NSApp.isActive
        if !ready {
          // Another application may hold activation briefly; keep asking.
          attempts += 1
          if attempts % 10 == 0 {
            self.window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
          }
        }
        return ready
      }, timeoutMs: 4000
    ) { ok, ms in
      reply([
        "ok": ok, "visible": !self.isOccluded(), "key": self.window.isKeyWindow,
        "active": NSApp.isActive, "ms": ms, "mode": mode,
      ])
    }
  }

  func moveSteps(
    dx: Double, dy: Double, count: Int, intervalMs: Double,
    reply: @escaping ([String: Any]) -> Void
  ) {
    var done = 0
    let start = uptimeMs()
    Timer.scheduledTimer(withTimeInterval: intervalMs / 1000, repeats: true) { timer in
      var origin = self.window.frame.origin
      origin.x += CGFloat(dx)
      origin.y += CGFloat(dy)
      self.window.setFrameOrigin(origin)
      done += 1
      if done >= count {
        timer.invalidate()
        reply(["ok": true, "steps": done, "ms": uptimeMs() - start])
      }
    }
  }

  /// Resizes the window like a user drag on the bottom-right corner: the top-left corner stays
  /// put, and with `live` the web view gets the same live-resize notifications AppKit sends.
  func resizeSteps(
    dw: Double, dh: Double, count: Int, intervalMs: Double, live: Bool,
    reply: @escaping ([String: Any]) -> Void
  ) {
    var done = 0
    let start = uptimeMs()
    if live {
      web.viewWillStartLiveResize()
      // What Terax gets from NSWindowWillStartLiveResizeNotification in the real app; a page
      // without the hook (older renderers, or the heuristic-only variant) ignores it.
      web.evaluateJavaScript("window.__teraxLiveResize && window.__teraxLiveResize(true)")
    }
    Timer.scheduledTimer(withTimeInterval: intervalMs / 1000, repeats: true) { timer in
      var frame = self.window.frame
      let top = frame.maxY
      frame.size.width = max(480, frame.size.width + CGFloat(dw))
      frame.size.height = max(320, frame.size.height + CGFloat(dh))
      frame.origin.y = top - frame.size.height
      self.window.setFrame(frame, display: true)
      done += 1
      if done >= count {
        timer.invalidate()
        if live {
          self.web.viewDidEndLiveResize()
          self.web.evaluateJavaScript("window.__teraxLiveResize && window.__teraxLiveResize(false)")
        }
        reply(["ok": true, "steps": done, "ms": uptimeMs() - start])
      }
    }
  }

  // MARK: - Orchestrator acknowledgements

  func startAckReader() {
    Thread.detachNewThread {
      while let line = readLine() {
        let parts = line.split(separator: " ")
        guard parts.count == 2, parts[0] == "ack", let id = Int(parts[1]) else { continue }
        DispatchQueue.main.async { self.pendingSync.removeValue(forKey: id)?(nil, nil) }
      }
      // The orchestrator went away; never leave a benchmark window behind.
      DispatchQueue.main.async { NSApp.terminate(nil) }
    }
  }

  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    print("navigation failed: \(error)")
    fflush(stdout)
  }
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = Delegate()
app.delegate = delegate
app.run()
