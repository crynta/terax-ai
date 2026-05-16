import { Fragment } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { SearchAddon } from "@xterm/addon-search";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";
import type { PaneNode, SplitDir } from "./lib/panes";

type LeafBundle = {
  setRef: (h: TerminalPaneHandle | null) => void;
  onSearch: (addon: SearchAddon) => void;
  onCwd: (cwd: string) => void;
  onExit: (code: number) => void;
};

type Props = {
  node: PaneNode;
  tabVisible: boolean;
  activeLeafId: number;
  onFocusLeaf: (leafId: number) => void;
  onSplitPane: (leafId: number, dir: SplitDir, before: boolean) => void;
  onClosePane: (leafId: number) => void;
  getBundle: (leafId: number) => LeafBundle;
};

export function PaneTreeView({
  node,
  tabVisible,
  activeLeafId,
  onFocusLeaf,
  onSplitPane,
  onClosePane,
  getBundle,
}: Props) {
  if (node.kind === "leaf") {
    const focused = node.id === activeLeafId;
    const b = getBundle(node.id);
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            onMouseDownCapture={() => {
              if (!focused) onFocusLeaf(node.id);
            }}
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
              ref={b.setRef}
              onSearchReady={(_id, addon) => b.onSearch(addon)}
              onCwd={(_id, cwd) => b.onCwd(cwd)}
              onExit={(_id, code) => b.onExit(code)}
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-44 rounded-2xl p-1">
          <ContextMenuItem
            className="rounded-xl px-2.5 py-1.5 text-xs gap-2"
            onSelect={() => onSplitPane(node.id, "col", true)}
          >
            Split Up
          </ContextMenuItem>
          <ContextMenuItem
            className="rounded-xl px-2.5 py-1.5 text-xs gap-2"
            onSelect={() => onSplitPane(node.id, "col", false)}
          >
            Split Down
          </ContextMenuItem>
          <ContextMenuItem
            className="rounded-xl px-2.5 py-1.5 text-xs gap-2"
            onSelect={() => onSplitPane(node.id, "row", true)}
          >
            Split Left
          </ContextMenuItem>
          <ContextMenuItem
            className="rounded-xl px-2.5 py-1.5 text-xs gap-2"
            onSelect={() => onSplitPane(node.id, "row", false)}
          >
            Split Right
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="rounded-xl px-2.5 py-1.5 text-xs gap-2"
            variant="destructive"
            onSelect={() => onClosePane(node.id)}
          >
            Close Pane
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return (
    <ResizablePanelGroup
      orientation={node.dir === "row" ? "horizontal" : "vertical"}
    >
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && <ResizableHandle />}
          <ResizablePanel id={`pane-${child.id}`} minSize="10%">
            <PaneTreeView
              node={child}
              tabVisible={tabVisible}
              activeLeafId={activeLeafId}
              onFocusLeaf={onFocusLeaf}
              onSplitPane={onSplitPane}
              onClosePane={onClosePane}
              getBundle={getBundle}
            />
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  );
}
