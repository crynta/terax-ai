import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { listSessionPrompts } from "./lib/contextClient";
import {
  type PromptHit,
  rankPrompts,
  type SessionPrompt,
} from "./lib/promptSearch";
import { HeaderButton } from "./ReaderChrome";

const MENU_Z = "z-[1000]";
/** Prompts listed before anything is typed: the latest asks. */
const RECENT = 8;

function timeLabel(at: string | null): string {
  if (!at) return "";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** The latest prompts, newest first, shown before a query is typed. */
function recentHits(prompts: readonly SessionPrompt[]): PromptHit[] {
  return prompts
    .slice(-RECENT)
    .map((prompt, i) => {
      const line = prompt.text.replace(/\s+/g, " ").trim();
      return {
        prompt,
        index: prompts.length - Math.min(RECENT, prompts.length) + i,
        related: false,
        snippet: {
          before: line.slice(0, 140),
          match: "",
          after: line.length > 140 ? "…" : "",
        },
      };
    })
    .reverse();
}

/**
 * The header's "search my prompts" button: a box that lists the session's
 * prompts matching what is typed (then related ones) and jumps to the turn
 * picked. `onJump` resolves false when that turn can't be shown.
 */
export function PromptSearch({
  sessionId,
  open,
  onOpenChange,
  turnCount,
  onJump,
}: {
  sessionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Refetches the prompts when the session grows while the box is open. */
  turnCount: number;
  onJump: (uuid: string) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const [prompts, setPrompts] = useState<SessionPrompt[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: turnCount refetches a grown session
  useEffect(() => {
    if (!open || !sessionId) return;
    let cancelled = false;
    listSessionPrompts(sessionId)
      .then((next) => {
        if (!cancelled) setPrompts(next);
      })
      .catch(() => {
        if (!cancelled) setPrompts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sessionId, turnCount]);

  useEffect(() => {
    if (open) return;
    setQuery("");
    setNotice(null);
  }, [open]);

  const hits = useMemo(
    () =>
      prompts === null
        ? []
        : query.trim()
          ? rankPrompts(prompts, query)
          : recentHits(prompts),
    [prompts, query],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new result list starts at its top
  useEffect(() => setSelected(0), [hits]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const pick = async (hit: PromptHit | undefined) => {
    if (!hit) return;
    setNotice(null);
    if (await onJump(hit.prompt.uuid)) onOpenChange(false);
    else
      setNotice(
        "This prompt is too far back to show here; open it from History.",
      );
  };
  const firstRelated = hits.findIndex((h) => h.related);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <HeaderButton
          icon={Search01Icon}
          label="Search"
          title="Search what you asked (⌘F)"
          active={open}
          disabled={!sessionId}
          onClick={() => onOpenChange(!open)}
        />
      </PopoverAnchor>
      <PopoverContent
        align="end"
        className={cn(MENU_Z, "w-[min(440px,90vw)] gap-0 rounded-2xl p-0")}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <input
          // biome-ignore lint/a11y/noAutofocus: the box opens to be typed in
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((i) => Math.min(i + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              void pick(hits[selected]);
            }
          }}
          placeholder="Search what you asked in this chat…"
          aria-label="Search my prompts"
          className="h-10 w-full rounded-t-2xl border-b border-border/60 bg-transparent px-3.5 text-[13px] outline-none placeholder:text-muted-foreground"
        />
        {notice && (
          <p className="border-b border-border/60 px-3.5 py-2 text-[12px] text-agent-attention">
            {notice}
          </p>
        )}
        <ol
          ref={list}
          aria-label="Matching prompts"
          className="max-h-[min(360px,60vh)] overflow-y-auto p-1.5"
        >
          {prompts === null ? (
            <li className="px-2.5 py-2 text-[12px] text-muted-foreground">
              Loading prompts…
            </li>
          ) : hits.length === 0 ? (
            <li className="px-2.5 py-2 text-[12px] text-muted-foreground">
              {query.trim() ? "No prompt matches." : "No prompts yet."}
            </li>
          ) : (
            hits.map((hit, i) => (
              <li key={hit.prompt.uuid} className="contents">
                {i === 0 && !query.trim() && (
                  <SectionLabel>Your latest asks</SectionLabel>
                )}
                {i === firstRelated && <SectionLabel>Related</SectionLabel>}
                <button
                  type="button"
                  data-index={i}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => void pick(hit)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-1.5 text-left outline-none",
                    i === selected && "bg-primary/10",
                  )}
                >
                  <span className="line-clamp-2 text-[12.5px] leading-snug text-foreground/90">
                    {hit.snippet.before}
                    {hit.snippet.match && (
                      <mark className="rounded-sm bg-primary/25 px-0.5 text-foreground">
                        {hit.snippet.match}
                      </mark>
                    )}
                    {hit.snippet.after}
                  </span>
                  <span className="text-[10.5px] tabular-nums text-muted-foreground">
                    Prompt {hit.index + 1}
                    {hit.prompt.at ? ` · ${timeLabel(hit.prompt.at)}` : ""}
                  </span>
                </button>
              </li>
            ))
          )}
        </ol>
      </PopoverContent>
    </Popover>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <span className="block px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </span>
  );
}
