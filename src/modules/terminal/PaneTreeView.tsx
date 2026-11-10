import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { SessionReader } from "@/modules/agents/reader/SessionReaderLazy";
import {
  closeReader,
  toggleReader,
  useReaderStore,
} from "@/modules/agents/reader/readerStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { AiChat02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { TerminalSearchController } from "@/modules/terminal/search/TerminalSearchController";
import { Fragment, useCallback, useEffect, useRef } from "react";
import { useAgentActivityStore } from "./lib/agentActivity";
import { useTerminalDropStore } from "./lib/dropStore";
import { firstLeafSlotId, type PaneNode } from "./lib/panes";
import {
  beginTerminalResizeInteraction,
  endTerminalResizeInteraction,
} from "./lib/terminalResizeInteraction";
import { ptyIdForLeaf } from "./lib/terminalSessionApi";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";

type LeafBundle = {
  setRef: (h: TerminalPaneHandle | null) => void;
  onSearchReady: (leafId: number, addon: TerminalSearchController) => void;
  onCwd: (leafId: number, cwd: string) => void;
  onExit: (leafId: number, code: number) => void;
};

type Props = {
  node: PaneNode;
  tabVisible: boolean;
  activeLeafId: number;
  blocks: boolean;
  onFocusLeaf: (leafId: number) => void;
  getBundle: (leafId: number) => LeafBundle;
  /** Set below the root of a tab that has more than one pane. */
  split?: boolean;
};

export function PaneTreeView(props: Props) {
  const { node } = props;
  if (node.kind === "leaf") {
    return <PaneLeaf {...props} node={node} />;
  }

  return (
    <ResizablePanelGroup
      orientation={node.dir === "row" ? "horizontal" : "vertical"}
    >
      {node.children.map((child, i) => {
        const slotId = firstLeafSlotId(child);
        return (
          <Fragment key={slotId}>
            {i > 0 && <TerminalResizableHandle />}
            <ResizablePanel id={`pane-slot-${slotId}`} minSize="10%">
              <PaneTreeView {...props} node={child} split />
            </ResizablePanel>
          </Fragment>
        );
      })}
    </ResizablePanelGroup>
  );
}

function PaneLeaf({
  node,
  tabVisible,
  activeLeafId,
  blocks,
  onFocusLeaf,
  getBundle,
  split = false,
}: Props & { node: Extract<PaneNode, { kind: "leaf" }> }) {
  const focused = node.id === activeLeafId;
  const b = getBundle(node.id);
  const padding = usePreferencesStore((s) => s.terminalPanePadding);
  // One leaf's phase: re-renders only when this pane's agent changes state.
  const phase = useAgentActivityStore((s) => {
    const ptyId = ptyIdForLeaf(node.id);
    return ptyId === null ? undefined : s.phases[ptyId];
  });
  const readerOpen = useReaderStore((s) => s.open[node.id] === true);
  return (
    <div
      onMouseDownCapture={() => {
        if (!focused) onFocusLeaf(node.id);
      }}
      // Catches focus from Tab, programmatic focus, or any path that
      // skips mousedown — keeps activeLeafId in sync with DOM focus.
      onFocus={() => {
        if (!focused) onFocusLeaf(node.id);
      }}
      data-pane-leaf={node.id}
      data-pane-focused={focused || undefined}
      data-pane-split={split || undefined}
      data-agent-phase={phase}
      className="terax-pane-leaf group/pane relative h-full w-full"
      style={padding > 0 ? { padding } : undefined}
    >
      <TerminalPane
        leafId={node.id}
        // The Reader covers the pane: pause GPU presentation, keep the pty running.
        visible={tabVisible && !readerOpen}
        focused={focused}
        initialCwd={node.cwd}
        blocks={blocks}
        ref={b.setRef}
        onSearchReady={b.onSearchReady}
        onCwd={b.onCwd}
        onExit={b.onExit}
      />
      {split && !focused && (
        <div aria-hidden className="terax-pane-dim pointer-events-none" />
      )}
      <div aria-hidden className="terax-pane-frame pointer-events-none" />
      {readerOpen && tabVisible && (
        <SessionReader
          leafId={node.id}
          cwd={node.cwd ?? null}
          onShowTerminal={() => closeReader(node.id)}
          focused={focused}
        />
      )}
      {phase !== undefined && !readerOpen && (
        <ReaderToggleButton leafId={node.id} />
      )}
      <DropOverlay leafId={node.id} />
    </div>
  );
}

function ReaderToggleButton({ leafId }: { leafId: number }) {
  return (
    <button
      type="button"
      aria-label="Open Session Reader"
      title="Open Session Reader (⌘⇧R)"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={() => toggleReader(leafId)}
      className="absolute top-2 right-3 z-[7] flex items-center gap-1.5 rounded-full border border-border/70 bg-popover px-2.5 py-1 text-[11px] font-medium text-foreground opacity-0 shadow-md outline-none transition-opacity duration-[var(--dur-fast)] hover:border-primary/50 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/40 group-hover/pane:opacity-100"
    >
      <HugeiconsIcon icon={AiChat02Icon} size={13} strokeWidth={1.8} />
      Reader
    </button>
  );
}

const RESIZE_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Home",
]);

function TerminalResizableHandle() {
  const interactionToken = useRef<object>({});
  const removePointerListeners = useRef<(() => void) | null>(null);

  const finish = useCallback(() => {
    removePointerListeners.current?.();
    removePointerListeners.current = null;
    endTerminalResizeInteraction(interactionToken.current);
  }, []);

  const startPointerInteraction = useCallback(() => {
    finish();
    beginTerminalResizeInteraction(interactionToken.current);
    const handlePointerEnd = () => finish();
    window.addEventListener("pointerup", handlePointerEnd, true);
    window.addEventListener("pointercancel", handlePointerEnd, true);
    removePointerListeners.current = () => {
      window.removeEventListener("pointerup", handlePointerEnd, true);
      window.removeEventListener("pointercancel", handlePointerEnd, true);
    };
  }, [finish]);

  useEffect(() => finish, [finish]);

  return (
    <ResizableHandle
      className="bg-border/50 transition-colors duration-[var(--dur-fast)] after:w-3 hover:bg-border"
      onPointerDownCapture={(event) => {
        if (event.button === 0) startPointerInteraction();
      }}
      onKeyDownCapture={(event) => {
        if (RESIZE_KEYS.has(event.key)) {
          beginTerminalResizeInteraction(interactionToken.current);
        }
      }}
      onKeyUpCapture={(event) => {
        if (RESIZE_KEYS.has(event.key)) finish();
      }}
      onBlur={finish}
    />
  );
}

function DropOverlay({ leafId }: { leafId: number }) {
  const active = useTerminalDropStore((s) => s.targetLeafId === leafId);
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-lg border border-primary/45 bg-background/70 text-xs font-medium text-foreground shadow-lg">
      Drop file path here
    </div>
  );
}
