import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { isMarkdownPath } from "@/lib/utils";
import { MarkdownViewToggle } from "@/modules/markdown";
import { firstLeafSlotId, type PaneNode } from "@/modules/terminal/lib/panes";
import { Fragment } from "react";
import { EditorPane, type EditorPaneHandle } from "./EditorPane";

export type EditorLeafBundle = {
  setRef: (h: EditorPaneHandle | null) => void;
  onDirtyChange: (dirty: boolean) => void;
  onClose: () => void;
  tabId: number;
  tabDirty: boolean;
  onSetMarkdownView: (mode: "rendered" | "raw") => void;
};

type Props = {
  node: PaneNode;
  activeLeafId: number;
  overrideLanguage?: string | null;
  onFocusLeaf: (leafId: number) => void;
  getBundle: (leafId: number) => EditorLeafBundle;
};

export function EditorPaneTreeView(props: Props) {
  const { node } = props;

  if (node.kind === "leaf") {
    const { activeLeafId, overrideLanguage, onFocusLeaf, getBundle } = props;
    const focused = node.id === activeLeafId;
    const b = getBundle(node.id);
    const path = node.path ?? "";

    return (
      <div
        onMouseDownCapture={() => {
          if (!focused) onFocusLeaf(node.id);
        }}
        onFocus={() => {
          if (!focused) onFocusLeaf(node.id);
        }}
        data-pane-leaf={node.id}
        className="relative h-full w-full overflow-hidden rounded-md border border-border/60 bg-background"
      >
        {isMarkdownPath(path) && (
          <MarkdownViewToggle
            mode="raw"
            onChange={b.onSetMarkdownView}
            renderedDisabled={b.tabDirty}
            renderedHint="Save to preview"
          />
        )}
        <EditorPane
          ref={b.setRef}
          path={path}
          overrideLanguage={overrideLanguage}
          onDirtyChange={b.onDirtyChange}
          onClose={b.onClose}
        />
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
            {i > 0 && <ResizableHandle />}
            <ResizablePanel id={`editor-pane-slot-${slotId}`} minSize="10%">
              <EditorPaneTreeView {...props} node={child} />
            </ResizablePanel>
          </Fragment>
        );
      })}
    </ResizablePanelGroup>
  );
}
