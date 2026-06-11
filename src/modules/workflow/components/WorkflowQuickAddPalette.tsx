import { useState, useCallback, useEffect, useRef } from "react";
import type { WorkflowNodeType } from "../lib/schema";

const NODE_TYPES: {
  type: WorkflowNodeType;
  label: string;
  category: string;
}[] = [
  { type: "textPrompt", label: "Text Prompt", category: "Input" },
  { type: "output", label: "Output", category: "Input" },
  { type: "terminal", label: "Terminal", category: "Input" },
  { type: "textTransform", label: "Text Transform", category: "Transform" },
  { type: "jsonExtract", label: "JSON Extract", category: "Transform" },
  { type: "jsonBuild", label: "JSON Build", category: "Transform" },
  { type: "if", label: "If", category: "Control" },
  { type: "switch", label: "Switch", category: "Control" },
  { type: "merge", label: "Merge", category: "Control" },
  { type: "retry", label: "Retry", category: "Control" },
  { type: "errorBranch", label: "Error Branch", category: "Control" },
  { type: "humanApproval", label: "Human Approval", category: "Control" },
  { type: "forEach", label: "For Each", category: "Data" },
  { type: "setVariable", label: "Set Variable", category: "Data" },
  { type: "getVariable", label: "Get Variable", category: "Data" },
  { type: "delay", label: "Delay", category: "Utility" },
  { type: "webhook", label: "Webhook", category: "Trigger" },
  { type: "schedule", label: "Schedule", category: "Trigger" },
  { type: "comment", label: "Comment", category: "Utility" },
  { type: "reroute", label: "Reroute", category: "Utility" },
  { type: "group", label: "Group", category: "Utility" },
  { type: "httpRequest", label: "HTTP Request", category: "Runtime" },
  { type: "shellCommand", label: "Shell Command", category: "Runtime" },
  { type: "agent", label: "Agent", category: "Runtime" },
  {
    type: "browserAutomation",
    label: "Browser Automation",
    category: "Runtime",
  },
  { type: "fileOperation", label: "File Operation", category: "Runtime" },
  { type: "imageGeneration", label: "Image Generation", category: "AI/Media" },
  { type: "videoGeneration", label: "Video Generation", category: "AI/Media" },
  { type: "audioGeneration", label: "Audio Generation", category: "AI/Media" },
];

export function WorkflowQuickAddPalette({
  onAddNode,
  onClose,
}: {
  onAddNode: (type: WorkflowNodeType) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = NODE_TYPES.filter(
    (n) =>
      n.label.toLowerCase().includes(query.toLowerCase()) ||
      n.type.toLowerCase().includes(query.toLowerCase()) ||
      n.category.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && filtered[selectedIndex]) {
        e.preventDefault();
        onAddNode(filtered[selectedIndex].type);
        onClose();
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [filtered, selectedIndex, onAddNode, onClose],
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh]">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-[360px] rounded-xl border border-border/60 bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center border-border/40 border-b px-3 py-2">
          <span className="text-muted-foreground text-sm mr-2">+</span>
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Search nodes..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <span className="text-muted-foreground text-[10px]">
            ESC to close
          </span>
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-muted-foreground text-xs">
              No nodes found
            </div>
          ) : (
            filtered.map((node, i) => (
              <button
                key={node.type}
                type="button"
                className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                  i === selectedIndex
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted/50 text-foreground"
                }`}
                onClick={() => {
                  onAddNode(node.type);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="font-medium">{node.label}</span>
                <span className="text-muted-foreground text-[10px]">
                  {node.category}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
