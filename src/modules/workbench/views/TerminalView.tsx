import type { TerminalTab } from "@/modules/tabs/lib/tabs";
import { useTerminalDropStore } from "@/modules/terminal/lib/dropStore";
import type { TerminalSearchController } from "@/modules/terminal/search/TerminalSearchController";
import {
  TerminalPane,
  type TerminalPaneHandle,
} from "@/modules/terminal/TerminalPane";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { memo, useCallback, useState } from "react";
import { closeTabsReplacingLast, restartTerminal } from "../actions";
import { planClose } from "../model/workbench";
import { snapshot } from "../store";
import { setViewHandle } from "../viewHandles";
import { reportCwd } from "./terminalCwd";
import { exitAction } from "./terminalExit";
import type { ViewProps } from "./types";

function onSearchReady(leafId: number, search: TerminalSearchController) {
  setViewHandle(leafId, "search", search);
}

export const TerminalView = memo(function TerminalView({
  tab,
  visible,
  focused,
}: ViewProps<TerminalTab>) {
  const id = tab.id;
  const setRef = useCallback(
    (handle: TerminalPaneHandle | null) =>
      setViewHandle(id, "terminal", handle),
    [id],
  );
  const [deadCode, setDeadCode] = useState<number | null>(null);
  const onExit = useCallback(
    (leafId: number, code: number, livedMs: number) => {
      const state = snapshot();
      const action = exitAction({
        onlyTabInWindow: state.tabs.length === 1,
        mustStay: planClose(state, [leafId]).kept.includes(leafId),
        livedMs,
      });
      if (action === "close-window") void getCurrentWindow().close();
      else if (action === "keep") setDeadCode(code);
      else if (action === "respawn") restartTerminal(leafId);
      else closeTabsReplacingLast([leafId]);
    },
    [],
  );
  return (
    <div data-pane-leaf={id} className="relative h-full w-full">
      <TerminalPane
        leafId={id}
        visible={visible}
        focused={focused}
        initialCwd={tab.cwd}
        blocks={tab.blocks ?? false}
        ref={setRef}
        onSearchReady={onSearchReady}
        onCwd={reportCwd}
        onExit={onExit}
      />
      <DropOverlay leafId={id} />
      {deadCode !== null && (
        <div
          role="alert"
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background p-6 text-center text-sm"
        >
          <strong>The shell exited right away</strong>
          <p className="max-w-md text-muted-foreground">
            Exit code {deadCode}. Check the shell's startup files or the
            workspace environment, then restart.
          </p>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 hover:bg-accent focus-visible:outline-2"
            onClick={() => restartTerminal(id)}
          >
            Restart shell
          </button>
        </div>
      )}
    </div>
  );
});

function DropOverlay({ leafId }: { leafId: number }) {
  const active = useTerminalDropStore((s) => s.targetLeafId === leafId);
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-lg border border-primary/45 bg-background/90 text-xs font-medium text-foreground shadow-lg">
      Drop file path here
    </div>
  );
}
