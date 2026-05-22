// src/modules/sidebar/panels/OutlinePanel.tsx
import type { EditorPaneHandle } from "@/modules/editor";
import type { OutlineNode } from "./outlineExtractor";
import {
  CodeIcon,
  Layers01Icon,
  TextSquareIcon,
  Menu01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

export type OutlinePanelProps = {
  activeEditorHandle: EditorPaneHandle | null;
};

const KIND_ICONS = {
  function: CodeIcon,
  class: Layers01Icon,
  variable: TextSquareIcon,
  heading: Menu01Icon,
  other: Menu01Icon,
} as const;

export function OutlinePanel({ activeEditorHandle }: OutlinePanelProps) {
  const [nodes, setNodes] = useState<OutlineNode[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!activeEditorHandle) {
      setNodes([]);
      return;
    }
    const refresh = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setNodes(activeEditorHandle.getOutline());
      }, 300);
    };
    refresh();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [activeEditorHandle]);

  if (!activeEditorHandle) {
    return (
      <p className="p-3 text-[11px] text-muted-foreground">
        Open a file to see its outline.
      </p>
    );
  }

  if (nodes.length === 0) {
    return (
      <p className="p-3 text-[11px] text-muted-foreground">
        No outline available for this file type.
      </p>
    );
  }

  return (
    <div className="h-full overflow-y-auto py-1">
      {nodes.map((node, i) => {
        const Icon = KIND_ICONS[node.kind];
        return (
          <button
            key={i}
            type="button"
            onClick={() => activeEditorHandle.goToLine(node.line)}
            style={{ paddingLeft: `${8 + (node.depth - 1) * 12}px` }}
            className="flex w-full items-center gap-1.5 py-1 pr-2 text-left text-[11.5px] text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
          >
            <HugeiconsIcon icon={Icon} size={12} strokeWidth={1.75} className="shrink-0" />
            <span className="min-w-0 truncate">{node.label}</span>
            <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground/50">
              {node.line}
            </span>
          </button>
        );
      })}
    </div>
  );
}
