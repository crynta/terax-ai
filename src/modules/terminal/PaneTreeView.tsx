import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { TerminalSearchController } from "@/modules/terminal/search/TerminalSearchController";
import { Fragment, useCallback, useEffect, useRef } from "react";
import { useTerminalDropStore } from "./lib/dropStore";
import { firstLeafSlotId, type PaneNode } from "./lib/panes";
import {
  beginTerminalResizeInteraction,
  endTerminalResizeInteraction,
} from "./lib/terminalResizeInteraction";
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
};

export function PaneTreeView(props: Props) {
  const { node } = props;
  if (node.kind === "leaf") {
    const { tabVisible, activeLeafId, blocks, onFocusLeaf, getBundle } = props;
    const focused = node.id === activeLeafId;
    const b = getBundle(node.id);
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
        className="relative h-full w-full"
      >
        <TerminalPane
          leafId={node.id}
          visible={tabVisible}
          focused={focused}
          initialCwd={node.cwd}
          blocks={blocks}
          ref={b.setRef}
          onSearchReady={b.onSearchReady}
          onCwd={b.onCwd}
          onExit={b.onExit}
        />
        <DropOverlay leafId={node.id} />
      </div>
    );
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
              <PaneTreeView {...props} node={child} />
            </ResizablePanel>
          </Fragment>
        );
      })}
    </ResizablePanelGroup>
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
    <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-lg border border-primary/45 bg-background/70 text-xs font-medium text-foreground shadow-lg backdrop-blur-sm">
      Drop file path here
    </div>
  );
}
