import { useState } from "react";
import { Panel } from "@xyflow/react";
import { Button } from "@/components/ui/button";

const SHORTCUTS = [
  { keys: "⌘Z", description: "Undo" },
  { keys: "⌘⇧Z", description: "Redo" },
  { keys: "⌘C", description: "Copy selected node" },
  { keys: "⌘V", description: "Paste node" },
  { keys: "⌦ / ⌫", description: "Delete selected node" },
  { keys: "?", description: "Show shortcuts" },
  { keys: "Esc", description: "Close panel / deselect" },
];

export function WorkflowShortcutsOverlay() {
  const [visible, setVisible] = useState(false);

  if (!visible) {
    return (
      <Panel position="bottom-left" className="!bottom-3">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="nodrag nowheel h-6 px-2 text-[10px] text-muted-foreground"
          onClick={() => setVisible(true)}
        >
          ? Shortcuts
        </Button>
      </Panel>
    );
  }

  return (
    <Panel
      position="bottom-left"
      className="!bottom-3 rounded-lg border border-border/60 bg-card/95 p-3 text-card-foreground shadow-lg backdrop-blur"
    >
      <div className="mb-2 flex items-center justify-between gap-4">
        <div className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
          Keyboard Shortcuts
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="nodrag nowheel h-5 w-5 p-0 text-[10px]"
          onClick={() => setVisible(false)}
        >
          ✕
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        {SHORTCUTS.map((s) => (
          <div
            key={s.keys}
            className="flex items-center justify-between gap-6 text-[11px]"
          >
            <span className="text-muted-foreground">{s.description}</span>
            <kbd className="rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px]">
              {s.keys}
            </kbd>
          </div>
        ))}
      </div>
    </Panel>
  );
}
