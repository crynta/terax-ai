import { cn } from "@/lib/utils";
import { writeToSession } from "@/modules/terminal/lib/terminalSessionApi";
import {
  Cancel01Icon,
  ComputerTerminal01Icon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { type ClaudePanel, panelKeyBytes } from "./lib/claudePanel";

const KEYS: { label: string; title: string; bytes: string }[] = [
  { label: "←", title: "Left (previous tab)", bytes: "\x1b[D" },
  { label: "↑", title: "Up", bytes: "\x1b[A" },
  { label: "↓", title: "Down", bytes: "\x1b[B" },
  { label: "→", title: "Right (next tab)", bytes: "\x1b[C" },
  { label: "Tab", title: "Tab", bytes: "\t" },
  { label: "Enter", title: "Enter", bytes: "\r" },
];

/**
 * One of Claude Code's interactive panels (`/usage`, `/mcp`, `/config`,
 * `/model`, `/agents`…), docked above the composer as Claude draws it. While
 * the card has focus every key goes to Claude, so it drives exactly like the
 * terminal: arrows, Enter, Tab, typing to filter, Esc to close.
 */
export function ClaudePanelCard({
  leafId,
  panel,
  onOpenTerminal,
  onClosed,
}: {
  leafId: number;
  panel: ClaudePanel;
  onOpenTerminal: () => void;
  /** Called when the panel leaves the screen, to hand focus back to the composer. */
  onClosed: () => void;
}) {
  const card = useRef<HTMLElement | null>(null);
  const selectedRow = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;

  // Take the keyboard when the panel opens; give it back when it closes.
  useEffect(() => {
    card.current?.focus({ preventScroll: true });
    return () => closedRef.current();
  }, []);

  // Keep Claude's cursor row in view as it moves through long lists.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the cursor moves
  useEffect(() => {
    selectedRow.current?.scrollIntoView({ block: "nearest" });
  }, [panel.selected, panel.lines]);

  const send = (bytes: string) => {
    setFailed(!writeToSession(leafId, bytes));
    card.current?.focus({ preventScroll: true });
  };

  return (
    <section
      ref={card}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the card forwards keys to Claude's panel
      tabIndex={0}
      aria-label={panel.title ?? "Claude panel"}
      onKeyDown={(e) => {
        const bytes = panelKeyBytes(e);
        if (bytes === null) return;
        e.preventDefault();
        e.stopPropagation();
        send(bytes);
      }}
      className="terax-reader-action rounded-2xl border border-border bg-card shadow-[0_10px_32px_-20px_rgba(0,0,0,0.8)] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
          <HugeiconsIcon icon={Settings02Icon} size={15} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Claude panel
          </div>
          {panel.tabs ? (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {panel.tabs.map((tab) => (
                <span
                  key={tab}
                  className="rounded-md border border-border px-1.5 py-px text-[11.5px] text-foreground"
                >
                  {tab}
                </span>
              ))}
            </div>
          ) : (
            <div className="truncate text-[13.5px] font-semibold text-foreground">
              {panel.title}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onOpenTerminal}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] text-muted-foreground outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <HugeiconsIcon icon={ComputerTerminal01Icon} size={12} />
          Open terminal
        </button>
        <button
          type="button"
          onClick={() => send("\x1b")}
          title="Close (Esc)"
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-muted-foreground outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} />
          Close
        </button>
      </header>

      <div className="max-h-[min(58vh,560px)] overflow-auto px-2 py-2">
        <div className="terax-reader-mono min-w-max text-[12.5px] leading-[1.55] text-foreground">
          {panel.lines.map((line, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional, as on screen
              key={i}
              ref={i === panel.selected ? selectedRow : undefined}
              className={cn(
                "whitespace-pre rounded-md px-2",
                i === panel.selected &&
                  "bg-[color-mix(in_oklab,var(--foreground)_11%,transparent)] font-medium",
              )}
            >
              {line || " "}
            </div>
          ))}
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-1.5 border-t border-border px-3 py-2">
        {KEYS.map((k) => (
          <button
            key={k.label}
            type="button"
            title={k.title}
            onClick={() => send(k.bytes)}
            className="terax-reader-mono min-w-7 rounded-md border border-border bg-background/60 px-1.5 py-0.5 text-[11.5px] text-foreground outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            {k.label}
          </button>
        ))}
        <span className="ml-1 min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {failed
            ? "The terminal isn't ready. Open it and try again."
            : (panel.hint ?? "Keys you press here go to Claude · Esc to close")}
        </span>
      </footer>
    </section>
  );
}
