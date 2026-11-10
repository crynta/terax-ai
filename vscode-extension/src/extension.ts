import { appendFileSync } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { ReaderHost, readerLocation } from "./panel";
import { type Leaf, SessionTracker } from "./sessions";

export function activate(context: vscode.ExtensionContext): void {
  // The Terax Claude hooks in ~/.claude/settings.json only print their
  // session marker inside a terminal that sets TERAX_TERMINAL.
  context.environmentVariableCollection.replace("TERAX_TERMINAL", "1");
  context.environmentVariableCollection.description =
    "Lets Claude's Terax hooks report the session to the Claude Reader.";

  const log = traced(vscode.window.createOutputChannel("Claude Reader", { log: true }));
  const tracker = new SessionTracker(log);
  const reader = new ReaderHost(context, tracker, log);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = "teraxReader.open";
  context.subscriptions.push(log, tracker, reader, status);
  log.info(`activated (VS Code ${vscode.version})`);

  const refreshStatus = () => {
    const live = tracker.all().filter((l) => l.alive);
    if (live.length === 0) {
      status.hide();
      return;
    }
    const attention = live.filter((l) => l.phase === "attention").length;
    const working = live.filter((l) => l.phase === "working").length;
    status.text =
      attention > 0
        ? `$(bell-dot) Claude · needs you`
        : working > 0
          ? `$(sync~spin) Claude · working`
          : `$(comment-discussion) Claude · done`;
    status.tooltip = "Open the Claude Reader";
    status.backgroundColor =
      attention > 0 ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
    status.show();
  };

  // In an editor tab the Reader has no always-visible home (the panel tab is
  // hidden), so each Claude terminal opens its tab once by itself: when
  // `claude` starts, when a running one links its session, or (at startup)
  // when a terminal is already running Claude. Closing the tab sticks.
  const autoOpened = new Set<number>();
  const autoOpen = (leaf: Leaf) => {
    if (!vscode.workspace.getConfiguration("teraxReader").get("autoOpen", true)) return;
    if (autoOpened.has(leaf.leafId)) return;
    autoOpened.add(leaf.leafId);
    reader.show(leaf, true);
  };
  const openRunning = () => {
    if (readerLocation() === "panel") return;
    for (const terminal of vscode.window.terminals) {
      const known = tracker.known(terminal);
      if (known?.alive || /\bclaude\b/i.test(terminal.name)) {
        autoOpen(known ?? tracker.leafFor(terminal));
      }
    }
  };
  openRunning();

  context.subscriptions.push(
    tracker.onChange((leaf) => {
      refreshStatus();
      if (readerLocation() !== "panel" && leaf.alive && leaf.sessionId) autoOpen(leaf);
    }),
    tracker.onGone((leafId) => {
      autoOpened.delete(leafId);
      refreshStatus();
    }),
    tracker.onClaudeStart((leaf) => {
      // A new run of `claude` in the same terminal opens it again.
      autoOpened.delete(leaf.leafId);
      autoOpen(leaf);
    }),
    vscode.window.onDidOpenTerminal(() => setTimeout(openRunning, 1500)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("teraxReader.location")) openRunning();
    }),
    vscode.commands.registerCommand("teraxReader.open", (arg?: unknown) => {
      const terminal = isTerminal(arg) ? arg : vscode.window.activeTerminal;
      const leaf = terminal ? tracker.leafFor(terminal) : pickBusiest(tracker.all());
      if (!leaf) {
        void vscode.window.showInformationMessage(
          "Run `claude` in a terminal first, then open the Reader.",
        );
        return;
      }
      reader.show(leaf);
    }),
    vscode.commands.registerCommand("teraxReader.pick", async () => {
      const items = vscode.window.terminals.map((t) => {
        const leaf = tracker.leafFor(t);
        return {
          label: t.name,
          description: leaf.alive ? `Claude · ${leaf.phase ?? "running"}` : "",
          detail: leaf.cwd ? path.basename(leaf.cwd) : undefined,
          leaf,
        };
      });
      const choice = await vscode.window.showQuickPick(items, {
        placeHolder: "Open the Reader for which terminal?",
      });
      if (choice) reader.show(choice.leaf);
    }),
    vscode.commands.registerCommand("teraxReader.showTerminal", () => {
      const leaf = pickBusiest(tracker.all());
      leaf?.terminal.show(false);
    }),
  );
}

export function deactivate(): void {}

/** With TERAX_READER_TRACE=<file>, the log is also appended there (for tests). */
function traced(log: vscode.LogOutputChannel): vscode.LogOutputChannel {
  const file = process.env.TERAX_READER_TRACE;
  if (!file) return log;
  const write = (level: string) => (message: string) => {
    appendFileSync(file, `${new Date().toISOString()} ${level} ${message}\n`);
  };
  return new Proxy(log, {
    get(target, prop, receiver) {
      if (prop === "info" || prop === "warn" || prop === "error") {
        const original = Reflect.get(target, prop, receiver) as (m: string) => void;
        const tee = write(prop);
        return (message: string) => {
          tee(message);
          original.call(target, message);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function isTerminal(x: unknown): x is vscode.Terminal {
  return !!x && typeof x === "object" && "sendText" in x && "processId" in x;
}

function pickBusiest(leaves: Leaf[]): Leaf | undefined {
  const rank = (l: Leaf) =>
    !l.alive ? 0 : l.phase === "attention" ? 3 : l.phase === "working" ? 2 : 1;
  return [...leaves].sort((a, b) => rank(b) - rank(a))[0];
}
