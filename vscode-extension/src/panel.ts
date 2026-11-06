import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import type {
  HostToWebview,
  ReaderAccent,
  ReaderFonts,
  ReaderTheme,
  WebviewToHost,
} from "./protocol";
import { handleRpc } from "./rpc";
import type { Leaf, SessionTracker } from "./sessions";
import { pastedImageDir } from "./transcript";

/** One webview showing the Reader for one terminal at a time. */
type Connection = {
  webview: vscode.Webview;
  leafId: () => number;
  /** Re-sends `init`, e.g. after the view switched to another terminal. */
  sendInit: () => Thenable<boolean>;
};

/**
 * Hosts the Reader webviews: the CLAUDE tab in the bottom panel (beside
 * TERMINAL, following the active Claude terminal) and, optionally, editor
 * tabs, one per terminal. Both speak the same protocol.
 */
export class ReaderHost implements vscode.Disposable, vscode.WebviewViewProvider {
  static readonly viewId = "teraxReader.view";

  private readonly connections = new Set<Connection>();
  private readonly tabs = new Map<number, vscode.WebviewPanel>();
  private readonly disposables: vscode.Disposable[] = [];
  private view: vscode.WebviewView | null = null;
  private viewConnection: Connection | null = null;
  private viewLeafId = 0;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly tracker: SessionTracker,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.disposables.push(
      vscode.window.registerWebviewViewProvider(ReaderHost.viewId, this, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
      tracker.onChange((leaf) => this.broadcast(leaf)),
      tracker.onGone((leafId) => {
        this.postAll({ type: "leafGone", leafId });
        if (leafId === this.viewLeafId) this.follow(this.fallbackLeaf());
      }),
      // The panel view follows whichever Claude terminal you switch to.
      vscode.window.onDidChangeActiveTerminal((terminal) => {
        const leaf = terminal ? this.tracker.known(terminal) : undefined;
        if (leaf && (leaf.alive || leaf.sessionId)) this.follow(leaf);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration("teraxReader.theme") ||
          e.affectsConfiguration("teraxReader.accent")
        ) {
          this.postAll({ type: "theme", theme: readerTheme(), accent: readerAccent() });
        }
        if (
          e.affectsConfiguration("teraxReader.fontSize") ||
          e.affectsConfiguration("chat.fontSize") ||
          e.affectsConfiguration("editor.fontSize")
        ) {
          this.postAll({ type: "fonts", fonts: readerFonts() });
        }
      }),
    );
  }

  /** Shows the Reader for `leaf` where the user wants it (panel tab or editor tab). */
  show(leaf: Leaf, preserveFocus = false): void {
    if (readerLocation() === "editor") {
      this.openTab(leaf, preserveFocus);
      return;
    }
    this.follow(leaf);
    if (this.view) this.view.show(preserveFocus);
    else void vscode.commands.executeCommand(`${ReaderHost.viewId}.focus`);
  }

  // ---------------------------------------------------------------- panel view

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    if (!this.viewLeafId) this.viewLeafId = this.fallbackLeaf()?.leafId ?? 0;
    const connection = this.connect(view.webview, () => this.viewLeafId, "panel");
    this.viewConnection = connection;
    this.describeView();
    view.onDidChangeVisibility(() => this.log.info(`panel view ${view.visible ? "shown" : "hidden"}`));
    view.onDidDispose(() => {
      this.connections.delete(connection);
      this.view = null;
      this.viewConnection = null;
    });
  }

  private follow(leaf: Leaf | undefined): void {
    const next = leaf?.leafId ?? 0;
    if (next === this.viewLeafId) return;
    this.viewLeafId = next;
    this.describeView();
    void this.viewConnection?.sendInit();
  }

  private describeView(): void {
    if (!this.view) return;
    const leaf = this.tracker.byId(this.viewLeafId);
    this.view.description = leaf ? describe(leaf) : undefined;
  }

  private fallbackLeaf(): Leaf | undefined {
    const rank = (l: Leaf) =>
      !l.alive ? (l.sessionId ? 1 : 0) : l.phase === "attention" ? 4 : l.phase === "working" ? 3 : 2;
    return [...this.tracker.all()].sort((a, b) => rank(b) - rank(a)).find((l) => rank(l) > 0);
  }

  // ---------------------------------------------------------------- editor tabs

  private openTab(leaf: Leaf, preserveFocus: boolean): void {
    const existing = this.tabs.get(leaf.leafId);
    if (existing) {
      existing.reveal(undefined, preserveFocus);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "teraxReader",
      `Claude · ${describe(leaf)}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus },
      { retainContextWhenHidden: true },
    );
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "media", "icon.png");
    const connection = this.connect(panel.webview, () => leaf.leafId, "tab");
    this.tabs.set(leaf.leafId, panel);
    panel.onDidDispose(() => {
      this.connections.delete(connection);
      this.tabs.delete(leaf.leafId);
    });
  }

  // ---------------------------------------------------------------- protocol

  private connect(webview: vscode.Webview, leafId: () => number, where: string): Connection {
    const dist = vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview");
    webview.options = {
      enableScripts: true,
      localResourceRoots: [dist, vscode.Uri.file(pastedImageDir())],
    };
    const downloads = path.join(os.homedir(), "Downloads");
    const sendInit = () => {
      const resourceBase = webview
        .asWebviewUri(vscode.Uri.file("/"))
        .toString()
        .replace(/\/$/u, "");
      return webview.postMessage({
        type: "init",
        leafId: leafId(),
        env: {
          home: os.homedir(),
          downloads,
          resourceBase,
          platform: process.platform,
          theme: readerTheme(),
          accent: readerAccent(),
          fonts: readerFonts(),
        },
        leaves: this.tracker.all().map((l) => this.tracker.state(l, true)),
      } satisfies HostToWebview);
    };
    const connection: Connection = { webview, leafId, sendInit };
    this.connections.add(connection);
    this.log.info(`open Reader (${where}) for leaf ${leafId()}`);
    // Listen before the HTML is set so the webview's first message can't be missed.
    webview.onDidReceiveMessage(async (msg: WebviewToHost) => {
      switch (msg.type) {
        case "log":
          if (msg.level === "error") this.log.error(`[webview ${where}] ${msg.message}`);
          else this.log.info(`[webview ${where}] ${msg.message}`);
          return;
        case "ready":
          this.log.info(`webview ${where} ready; sending init for leaf ${leafId()}`);
          await sendInit();
          return;
        case "write":
          this.tracker.write(msg.leafId, msg.data);
          return;
        case "rpc":
          try {
            const value = await handleRpc(
              {
                tracker: this.tracker,
                leafId: leafId(),
                state: this.context.globalState,
                downloads,
              },
              msg.cmd,
              msg.args ?? {},
            );
            await webview.postMessage({ type: "rpcResult", id: msg.id, ok: true, value: value ?? null });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log.warn(`rpc ${msg.cmd} failed: ${message}`);
            await webview.postMessage({ type: "rpcResult", id: msg.id, ok: false, error: message });
          }
      }
    });
    webview.html = html(webview, dist);
    return connection;
  }

  /** Every Reader mirrors every terminal: a fork drives its new terminal too. */
  private broadcast(leaf: Leaf): void {
    this.postAll({ type: "leaf", leaf: this.tracker.state(leaf, true) });
    this.retitleTab(leaf);
    if (leaf.leafId === this.viewLeafId) this.describeView();
    // A Claude run starting elsewhere takes over an idle panel view.
    if (leaf.alive && !this.tracker.byId(this.viewLeafId)?.alive) this.follow(leaf);
  }

  private retitleTab(leaf: Leaf): void {
    const tab = this.tabs.get(leaf.leafId);
    if (tab) tab.title = `${phaseDot(leaf)}Claude · ${describe(leaf)}`;
  }

  private postAll(msg: HostToWebview): void {
    for (const c of this.connections) void c.webview.postMessage(msg);
  }

  dispose(): void {
    for (const tab of this.tabs.values()) tab.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

function describe(leaf: Leaf): string {
  return leaf.cwd ? path.basename(leaf.cwd) : leaf.terminal.name;
}

function phaseDot(leaf: Leaf): string {
  return leaf.phase === "attention" ? "● " : leaf.phase === "working" ? "◌ " : "";
}

function readerLocation(): "panel" | "editor" {
  const value = vscode.workspace.getConfiguration("teraxReader").get<string>("location");
  return value === "editor" ? "editor" : "panel";
}

function readerTheme(): ReaderTheme {
  const value = vscode.workspace.getConfiguration("teraxReader").get<string>("theme");
  return value === "tokyo-night" ? "tokyo-night" : "vscode";
}

function readerAccent(): ReaderAccent {
  const value = vscode.workspace.getConfiguration("teraxReader").get<string>("accent");
  return value === "theme" ? "theme" : "neutral";
}

/**
 * Prose follows `teraxReader.fontSize` when set, else VS Code's chat panel
 * size (`chat.fontSize`), else the editor size + 1; code follows the editor.
 */
function readerFonts(): ReaderFonts {
  const num = (section: string, key: string): number | null => {
    const v = vscode.workspace.getConfiguration(section).get<unknown>(key);
    return typeof v === "number" && v > 0 ? v : null;
  };
  const code = num("editor", "fontSize") ?? (process.platform === "darwin" ? 12 : 14);
  const prose = num("teraxReader", "fontSize") ?? num("chat", "fontSize") ?? code + 1;
  return { prose, code };
}

/**
 * Runs before the bundle: owns the VS Code API handle, shows any load or
 * runtime error inside the webview and forwards it to the "Claude Reader" log,
 * so a failure is never just a blank view.
 */
const DIAGNOSTICS = `(function () {
  var api = acquireVsCodeApi();
  window.__teraxVsCode = api;
  function show(text) {
    var el = document.getElementById("reader-diag");
    if (!el) {
      el = document.createElement("pre");
      el.id = "reader-diag";
      el.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;max-height:45%;overflow:auto;margin:0;padding:10px;border-radius:8px;font:12px/1.5 var(--vscode-editor-font-family);color:var(--vscode-errorForeground);background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-errorForeground);white-space:pre-wrap;z-index:2147483647";
      document.body.appendChild(el);
    }
    el.textContent += text + "\\n";
    try { api.postMessage({ type: "log", level: "error", message: text }); } catch (e) {}
  }
  window.__teraxShowError = show;
  window.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t !== window && (t.src || t.href)) show("Failed to load " + (t.src || t.href));
    else show("Error: " + (e.message || e.type) + (e.filename ? " (" + e.filename + ":" + e.lineno + ")" : ""));
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    show("Unhandled: " + (r && (r.stack || r.message) || r));
  });
})();`;

function html(webview: vscode.Webview, dist: vscode.Uri): string {
  const nonce = randomBytes(16).toString("base64");
  const asset = (p: string) => webview.asWebviewUri(vscode.Uri.joinPath(dist, p)).toString();
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data: blob: https:`,
    `font-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    `connect-src ${webview.cspSource}`,
  ].join("; ");
  return `<!doctype html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="${asset("assets/main.css")}" />
<title>Claude Reader</title>
</head>
<body>
<div id="root"><div style="padding:24px;opacity:.6;font:13px var(--vscode-font-family)">Starting Claude Reader…</div></div>
<script nonce="${nonce}">${DIAGNOSTICS}</script>
<script type="module" nonce="${nonce}" src="${asset("assets/main.js")}"></script>
</body>
</html>`;
}
