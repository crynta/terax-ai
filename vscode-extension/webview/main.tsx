import { setAgentCommandLauncher } from "@/modules/agents/lib/agentLaunchBridge";
import SessionReader from "@/modules/agents/reader/SessionReader";
import { setTerminalFileOpener } from "@/modules/terminal/lib/terminalFileLinks";
import { Component, type ReactNode, StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  announceReady,
  hostLog,
  hostState,
  onFontsChange,
  onInit,
  onLeafChange,
  onThemeChange,
  rpc,
} from "./bridge";
import "./index.css";
import "./shims/stores";
import { applyReaderFonts } from "./fontSize";
import { applyReaderTheme } from "./theme";

applyReaderTheme("tokyo-night");
onThemeChange(applyReaderTheme);
onFontsChange(applyReaderFonts);

setTerminalFileOpener((path, line) => {
  void rpc("host_open_file", { path, line: line ?? null });
});

setAgentCommandLauncher(({ cwd, title, command }) => {
  // The host opens a VS Code terminal and runs the command; the new leaf id
  // is filled in before `started` resolves (callers only read it after).
  const launched = { leafId: -1, started: Promise.resolve(false) };
  launched.started = rpc<number>("host_launch", { cwd, title, command })
    .then((leafId) => {
      launched.leafId = leafId;
      return true;
    })
    .catch(() => false);
  return launched;
});

function App() {
  const [ready, setReady] = useState(false);
  // The panel view re-inits when it follows another terminal.
  const [leafId, setLeafId] = useState(0);
  const [cwd, setCwd] = useState<string | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const offInit = onInit(() => {
      setLeafId(hostState.leafId);
      setCwd(hostState.leaves.get(hostState.leafId)?.cwd ?? null);
      setGone(false);
      setReady(true);
    });
    const off = onLeafChange((leaf, id) => {
      if (id !== hostState.leafId) return;
      if (!leaf) setGone(true);
      else if (leaf.cwd) setCwd(leaf.cwd);
    });
    announceReady();
    return () => {
      offInit();
      off();
    };
  }, []);

  if (!ready) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Connecting to VS Code…</div>
    );
  }
  if (gone || !hostState.leaves.has(leafId)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 p-6 text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">
          {gone ? "This terminal was closed." : "No Claude session yet"}
        </p>
        <p>
          Run <code className="rounded bg-muted px-1.5 py-0.5">claude</code> in a terminal and
          the Reader picks it up here.
        </p>
      </div>
    );
  }
  return (
    <div className="relative h-full w-full">
      <SessionReader
        key={leafId}
        leafId={leafId}
        cwd={cwd}
        onShowTerminal={() => void rpc("host_show_terminal", { leafId })}
        focused
      />
    </div>
  );
}

/** Shows a render crash in the panel (and the log) instead of a blank tab. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    hostLog(`render failed: ${error.stack ?? error.message}`, "error");
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="p-6 text-sm">
        <p className="mb-2 font-medium text-destructive">The Reader hit an error.</p>
        <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
          {error.stack ?? error.message}
        </pre>
      </div>
    );
  }
}

const root = document.getElementById("root");
if (root) {
  hostLog("bundle loaded");
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}
