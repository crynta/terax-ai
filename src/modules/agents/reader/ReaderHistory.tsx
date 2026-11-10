import { cn } from "@/lib/utils";
import {
  BookOpen01Icon,
  Cancel01Icon,
  Clock01Icon,
  Copy01Icon,
  PlayIcon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  listPastChats,
  type PastChat,
  type PromptMatch,
  searchPastChats,
} from "./lib/contextClient";
import {
  filterHistory,
  groupHistory,
  type HistoryRow,
  relativeTime,
} from "./lib/history";
import { loadSessionTitles, useSessionTitles } from "./lib/sessionTitles";

const LIST_LIMIT = 100;
const SEARCH_DEBOUNCE_MS = 260;

type ListState =
  | { kind: "loading" }
  | { kind: "ready"; chats: PastChat[] }
  | { kind: "error"; message: string };

/**
 * Past Claude sessions for a folder, grouped by day and searchable by title,
 * first prompt and (from two characters) the text of every prompt.
 */
export function HistoryPanel({
  cwd,
  liveSessionId,
  onOpen,
  onResume,
  onClose,
  dense = false,
}: {
  cwd: string | null;
  /** The session the pane is running now: marked "Live" and not resumable. */
  liveSessionId: string | null;
  onOpen: (sessionId: string) => void;
  onResume: (sessionId: string) => void;
  onClose?: () => void;
  /** Sidebar layout: tighter rows, no header close button. */
  dense?: boolean;
}) {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<PromptMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const titles = useSessionTitles((s) => s.titles);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void loadSessionTitles();
  }, []);

  useEffect(() => {
    if (!cwd) {
      setState({ kind: "ready", chats: [] });
      return;
    }
    let live = true;
    setState({ kind: "loading" });
    void listPastChats(cwd, LIST_LIMIT)
      .then((chats) => live && setState({ kind: "ready", chats }))
      .catch(
        (error: unknown) =>
          live && setState({ kind: "error", message: String(error) }),
      );
    return () => {
      live = false;
    };
  }, [cwd]);

  // Full-text search over prompts, debounced; the newest query wins.
  useEffect(() => {
    const q = query.trim();
    if (!cwd || q.length < 2) {
      setMatches([]);
      setSearching(false);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      void searchPastChats(cwd, q)
        .then((found) => live && setMatches(found))
        .catch(() => live && setMatches([]))
        .finally(() => live && setSearching(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [cwd, query]);

  const now = Date.now();
  const groups = useMemo(
    () =>
      state.kind === "ready"
        ? groupHistory(
            filterHistory(state.chats, query, matches, titles),
            Date.now(),
          )
        : [],
    [state, query, matches, titles],
  );

  return (
    <section aria-label="Chat history" className="flex min-h-0 flex-1 flex-col">
      {!dense && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2.5">
          <HugeiconsIcon
            icon={Clock01Icon}
            size={14}
            strokeWidth={1.8}
            className="text-primary"
          />
          <span className="text-[12.5px] font-semibold text-foreground">
            Chat history
          </span>
          {state.kind === "ready" && (
            <span className="text-[11.5px] tabular-nums text-muted-foreground">
              {state.chats.length}
            </span>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close history"
              className="ml-auto grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} />
            </button>
          )}
        </div>
      )}
      <div className={cn("shrink-0", dense ? "px-1 pb-2" : "px-3 pt-3 pb-2")}>
        <label className="flex h-8 items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-2.5 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
          <HugeiconsIcon
            icon={Search01Icon}
            size={13}
            strokeWidth={1.9}
            className="shrink-0 text-muted-foreground"
          />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                if (query) setQuery("");
                else onClose?.();
              }
            }}
            placeholder="Search chats and prompts"
            aria-label="Search chat history"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/80"
          />
          {searching && (
            <span className="size-3 shrink-0 animate-spin rounded-full border-[1.5px] border-muted-foreground/40 border-t-primary motion-reduce:animate-none" />
          )}
        </label>
      </div>
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          dense ? "px-1" : "px-3 pb-4",
        )}
      >
        {state.kind === "loading" && (
          <div className="flex flex-col gap-2 pt-1" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-lg bg-muted/40 motion-reduce:animate-none"
              />
            ))}
          </div>
        )}
        {state.kind === "error" && (
          <p className="px-1 pt-2 text-[12px] text-[var(--terminal-ansi-red)]">
            Couldn't list chats: {state.message}
          </p>
        )}
        {state.kind === "ready" && groups.length === 0 && (
          <p className="px-1 pt-3 text-center text-[12px] text-muted-foreground">
            {query.trim()
              ? searching
                ? "Searching…"
                : "No chats match."
              : cwd
                ? "No past chats in this folder yet."
                : "Open a folder to see its chats."}
          </p>
        )}
        {groups.map((group) => (
          <div key={group.id} className="mb-3">
            <h4 className="px-1 pb-1.5 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/90">
              {group.label}
            </h4>
            <ul className="flex flex-col gap-1.5">
              {group.rows.map((row) => (
                <HistoryRowView
                  key={row.chat.sessionId}
                  row={row}
                  now={now}
                  live={row.chat.sessionId === liveSessionId}
                  dense={dense}
                  onOpen={onOpen}
                  onResume={onResume}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function HistoryRowView({
  row,
  now,
  live,
  dense,
  onOpen,
  onResume,
}: {
  row: HistoryRow;
  now: number;
  live: boolean;
  dense: boolean;
  onOpen: (sessionId: string) => void;
  onResume: (sessionId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const id = row.chat.sessionId;
  const turns = row.chat.turns;
  const copyId = () => {
    void navigator.clipboard
      .writeText(id)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  };
  return (
    <li className="group relative rounded-lg border border-border/50 bg-card/60 transition-colors hover:border-border hover:bg-card">
      <button
        type="button"
        onClick={() => onOpen(id)}
        className={cn(
          "flex w-full flex-col items-start gap-0.5 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          dense ? "px-2.5 py-2 pr-16" : "px-3 py-2.5 pr-24",
        )}
      >
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <span className="truncate text-[12.5px] font-medium text-foreground">
            {row.title}
          </span>
          {live && (
            <span className="shrink-0 rounded-full bg-[color-mix(in_oklab,var(--agent-working)_16%,transparent)] px-1.5 text-[10px] font-semibold text-agent-working">
              Live
            </span>
          )}
        </span>
        {row.preview && row.preview !== row.title && (
          <span
            className={cn(
              "line-clamp-2 text-[11.5px] leading-snug",
              row.matched ? "text-foreground/80" : "text-muted-foreground",
            )}
          >
            {row.preview}
          </span>
        )}
        <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] tabular-nums text-muted-foreground">
          <span>{relativeTime(row.chat.modifiedMs, now)}</span>
          {typeof turns === "number" && (
            <>
              <span aria-hidden>·</span>
              <span>
                {turns} turn{turns === 1 ? "" : "s"}
              </span>
            </>
          )}
          {row.matched && (
            <>
              <span aria-hidden>·</span>
              <span className="text-primary">prompt match</span>
            </>
          )}
        </span>
      </button>
      <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <RowAction
          label="Open (read only)"
          icon={BookOpen01Icon}
          onClick={() => onOpen(id)}
        />
        {!live && (
          <RowAction
            label="Resume in a new tab"
            icon={PlayIcon}
            onClick={() => onResume(id)}
          />
        )}
        <RowAction
          label={copied ? "Copied" : "Copy session id"}
          icon={copied ? Tick02Icon : Copy01Icon}
          onClick={copyId}
        />
      </div>
    </li>
  );
}

function RowAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: typeof PlayIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.07] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <HugeiconsIcon icon={icon} size={13} strokeWidth={1.9} />
    </button>
  );
}
