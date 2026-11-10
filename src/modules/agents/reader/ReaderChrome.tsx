import { useGitBranch } from "@/app/components/useGitBranch";
import { cn } from "@/lib/utils";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  PinIcon,
  PinOffIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  findMatches,
  type OutlineItem,
  type ReaderFilters,
  type SessionStats,
} from "./lib/readerDoc";
import { type PinnedTurn, pinsInOrder } from "./lib/pinnedTurns";
import { displayPath, formatClock, formatDuration } from "./lib/readerView";
import { formatTokens, type SessionInfo } from "./lib/sessionInfo";
import { FileChip, type ReaderContext } from "./ReaderBlocks";

/**
 * In-document search with the CSS Custom Highlight API: every match is
 * highlighted, the current one more strongly, and next/prev scroll to it.
 */
export function useReaderSearch(
  container: RefObject<HTMLElement | null>,
  scroller: RefObject<HTMLElement | null>,
  query: string,
  version: number,
) {
  const ranges = useRef<Range[]>([]);
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(0);
  const supported = typeof CSS !== "undefined" && "highlights" in CSS;

  const paint = useCallback(
    (current: number) => {
      if (!supported) return;
      const all = ranges.current;
      CSS.highlights.set("terax-reader-match", new Highlight(...all));
      const active = all[current];
      if (active)
        CSS.highlights.set("terax-reader-current", new Highlight(active));
      else CSS.highlights.delete("terax-reader-current");
    },
    [supported],
  );

  const reveal = useCallback(
    (current: number) => {
      const range = ranges.current[current];
      const el = scroller.current;
      if (!range || !el) return;
      const rect = range.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      el.scrollTo({
        top: el.scrollTop + rect.top - box.top - el.clientHeight / 3,
      });
    },
    [scroller],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: version re-scans new content
  useEffect(() => {
    const root = container.current;
    const timer = setTimeout(() => {
      const found: Range[] = [];
      if (root && query.trim()) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.nodeValue ?? "";
          for (const at of findMatches(text, query.trim())) {
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + query.trim().length);
            found.push(range);
          }
        }
      }
      ranges.current = found;
      setCount(found.length);
      setIndex(0);
      paint(0);
    }, 120);
    return () => clearTimeout(timer);
  }, [container, query, version, paint]);

  useEffect(
    () => () => {
      if (!supported) return;
      CSS.highlights.delete("terax-reader-match");
      CSS.highlights.delete("terax-reader-current");
    },
    [supported],
  );

  const step = useCallback(
    (delta: number) => {
      const total = ranges.current.length;
      if (total === 0) return;
      setIndex((i) => {
        const next = (i + delta + total) % total;
        paint(next);
        reveal(next);
        return next;
      });
    },
    [paint, reveal],
  );

  return { count, index, next: () => step(1), prev: () => step(-1) };
}

export function SearchBox({
  query,
  onQuery,
  count,
  index,
  onNext,
  onPrev,
}: {
  query: string;
  onQuery: (q: string) => void;
  count: number;
  index: number;
  onNext: () => void;
  onPrev: () => void;
}) {
  return (
    <div className="flex h-8 min-w-0 items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 pr-1 pl-2.5 focus-within:border-primary/55">
      <HugeiconsIcon
        icon={Search01Icon}
        size={13}
        className="shrink-0 text-muted-foreground"
      />
      <input
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          }
          if (e.key === "Escape" && query) {
            e.stopPropagation();
            onQuery("");
          }
        }}
        placeholder="Search this session"
        aria-label="Search this session"
        className="w-44 min-w-0 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/80"
      />
      {query && (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {count === 0 ? "0" : `${index + 1}/${count}`}
        </span>
      )}
      <IconButton label="Previous match" onClick={onPrev} disabled={!count}>
        <HugeiconsIcon icon={ArrowUp01Icon} size={13} />
      </IconButton>
      <IconButton label="Next match" onClick={onNext} disabled={!count}>
        <HugeiconsIcon icon={ArrowDown01Icon} size={13} />
      </IconButton>
    </div>
  );
}

export function IconButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-35",
        active && "bg-primary/15 text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function ToggleChip({
  label,
  on,
  onToggle,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={cn(
        "h-7 shrink-0 rounded-lg border px-2.5 text-[11.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
        on
          ? "border-primary/45 bg-primary/12 text-foreground"
          : "border-border/70 text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

/** Which turn is at the top of the reading area. */
export function useCurrentTurn(
  scroller: RefObject<HTMLElement | null>,
  ids: readonly string[],
): string | null {
  const [current, setCurrent] = useState<string | null>(null);
  const key = ids.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-observe when the turn list changes
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.turnId;
          if (!id) continue;
          if (entry.isIntersecting)
            visible.set(id, entry.boundingClientRect.top);
          else visible.delete(id);
        }
        let best: string | null = null;
        let bestTop = Number.POSITIVE_INFINITY;
        for (const [id, top] of visible) {
          if (top < bestTop) {
            bestTop = top;
            best = id;
          }
        }
        if (best) setCurrent(best);
      },
      { root, rootMargin: "0px 0px -55% 0px" },
    );
    for (const el of root.querySelectorAll<HTMLElement>("[data-turn-id]"))
      observer.observe(el);
    return () => observer.disconnect();
  }, [scroller, key]);
  return current;
}

export function scrollToTurn(scroller: HTMLElement | null, id: string): void {
  const target = scroller?.querySelector<HTMLElement>(
    `[data-turn-id="${CSS.escape(id)}"]`,
  );
  if (!scroller || !target) return;
  const top =
    target.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop -
    8;
  scroller.scrollTo({ top });
}

/** Briefly highlights the turn `id`, after a jump to it. */
export function flashTurn(scroller: HTMLElement | null, id: string): void {
  const target = scroller?.querySelector<HTMLElement>(
    `[data-turn-id="${CSS.escape(id)}"]`,
  );
  if (!target) return;
  target.classList.remove("terax-reader-turn-flash");
  // Restart the animation when the same turn is picked twice.
  void target.offsetWidth;
  target.classList.add("terax-reader-turn-flash");
  setTimeout(() => target.classList.remove("terax-reader-turn-flash"), 1400);
}

type OutlineTab = "pinned" | "all";

/**
 * The full view's turn list: "Pinned" (the turns the user pinned, the default
 * when there are any) and "All". Picking an entry scrolls to its turn.
 */
export function OutlinePanel({
  items,
  current,
  onPick,
  pins,
  onPickPin,
  onUnpin,
  onTogglePin,
}: {
  items: readonly OutlineItem[];
  current: string | null;
  onPick: (id: string) => void;
  pins: readonly PinnedTurn[];
  /** Jumps to a pinned turn, paging back to it if it isn't loaded. */
  onPickPin: (id: string) => void;
  onUnpin: (id: string) => void;
  /** Pins or unpins a turn from the "All" list; absent when it can't be pinned. */
  onTogglePin?: (item: OutlineItem) => void;
}) {
  const list = useRef<HTMLOListElement | null>(null);
  const [chosen, setChosen] = useState<OutlineTab | null>(null);
  const tab: OutlineTab = chosen ?? (pins.length > 0 ? "pinned" : "all");
  const pinnedIds = useMemo(() => new Set(pins.map((p) => p.id)), [pins]);
  const numbers = useMemo(
    () => new Map(items.map((item, n) => [item.id, n + 1])),
    [items],
  );
  const ordered = useMemo(() => pinsInOrder(pins), [pins]);
  useEffect(() => {
    if (!current || tab !== "all") return;
    list.current
      ?.querySelector<HTMLElement>(`[data-outline-id="${CSS.escape(current)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current, tab]);
  const tabButton = (id: OutlineTab, label: string, count: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setChosen(id)}
      className={cn(
        "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-[11.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
        tab === id
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
  return (
    <nav
      aria-label="Turns"
      className="flex min-h-0 w-64 shrink-0 flex-col border-r border-border/60 bg-sidebar/60"
    >
      <div
        role="tablist"
        aria-label="Turn list"
        className="mx-3 mt-3 mb-2 flex gap-1 rounded-lg bg-foreground/[0.05] p-0.5"
      >
        {tabButton("pinned", "Pinned", pins.length)}
        {tabButton("all", "All", items.length)}
      </div>
      <ol ref={list} className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {tab === "pinned" ? (
          ordered.length === 0 ? (
            <li className="px-2.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
              No pinned turns yet. Hover a turn and press the pin to keep it
              here.
            </li>
          ) : (
            ordered.map((pin) => {
              const n = numbers.get(pin.id);
              return (
                <li key={pin.id} className="group/pin relative">
                  <button
                    type="button"
                    data-outline-id={pin.id}
                    aria-current={pin.id === current}
                    onClick={() => onPickPin(pin.id)}
                    className="terax-reader-outline-item flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 pr-9 text-left text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <span className="flex items-center gap-1.5 text-[10.5px] tabular-nums">
                      <HugeiconsIcon
                        icon={PinIcon}
                        size={11}
                        strokeWidth={2}
                        className="text-primary"
                      />
                      {n !== undefined && (
                        <span className="font-semibold text-primary/90">{n}</span>
                      )}
                      {formatClock(pin.at) && <span>{formatClock(pin.at)}</span>}
                    </span>
                    <span className="line-clamp-2 text-[12.5px] leading-snug text-foreground/90">
                      {pin.summary}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnpin(pin.id)}
                    aria-label="Unpin"
                    title="Unpin"
                    className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-md text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/40 group-hover/pin:opacity-100"
                  >
                    <HugeiconsIcon icon={PinOffIcon} size={14} strokeWidth={2} />
                  </button>
                </li>
              );
            })
          )
        ) : (
          items.map((item, n) => (
            <li key={item.id} className="group/pin relative">
              <button
                type="button"
                data-outline-id={item.id}
                aria-current={item.id === current}
                onClick={() => onPick(item.id)}
                className={cn(
                  "terax-reader-outline-item group flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40",
                  onTogglePin && "pr-9",
                )}
              >
                <span className="flex items-center gap-1.5 text-[10.5px] tabular-nums">
                  <span className="font-semibold text-primary/90">{n + 1}</span>
                  {pinnedIds.has(item.id) && (
                    <HugeiconsIcon
                      icon={PinIcon}
                      size={11}
                      strokeWidth={2}
                      className="text-primary"
                      aria-label="Pinned"
                    />
                  )}
                  {formatClock(item.at) && <span>{formatClock(item.at)}</span>}
                  {item.tools > 0 && (
                    <span className="ml-auto">
                      {item.tools} tool{item.tools === 1 ? "" : "s"}
                      {item.edits > 0
                        ? ` · ${item.edits} edit${item.edits === 1 ? "" : "s"}`
                        : ""}
                    </span>
                  )}
                </span>
                <span className="line-clamp-2 text-[12.5px] leading-snug">
                  {item.summary}
                </span>
              </button>
              {onTogglePin && item.pinnable && (
                <button
                  type="button"
                  onClick={() => onTogglePin(item)}
                  aria-pressed={pinnedIds.has(item.id)}
                  aria-label={pinnedIds.has(item.id) ? "Unpin" : "Pin"}
                  title={pinnedIds.has(item.id) ? "Unpin" : "Pin"}
                  className={cn(
                    "absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-md outline-none transition-[opacity,color,background-color] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/40",
                    pinnedIds.has(item.id)
                      ? "bg-primary/15 text-primary hover:bg-primary/25"
                      : "text-muted-foreground opacity-0 hover:bg-foreground/10 hover:text-foreground group-hover/pin:opacity-100",
                  )}
                >
                  <HugeiconsIcon
                    icon={pinnedIds.has(item.id) ? PinOffIcon : PinIcon}
                    size={14}
                    strokeWidth={2}
                  />
                </button>
              )}
            </li>
          ))
        )}
      </ol>
    </nav>
  );
}

export function InfoPanel({
  title,
  cwd,
  phaseLabel,
  elapsed,
  stats,
  info,
  live,
  ctx,
  onClose,
  children,
}: {
  title: string;
  cwd: string | null;
  phaseLabel: string | null;
  elapsed: string | null;
  stats: SessionStats;
  info: SessionInfo;
  live: boolean;
  ctx: ReaderContext;
  onClose: () => void;
  /** The session facts card (model, mode, context, cost, changes, duration, agents). */
  children?: ReactNode;
}) {
  const branch = useGitBranch(cwd);
  const duration = useSessionDuration(info, live);
  const rows: [string, string | null][] = [
    ["Folder", cwd ? displayPath(cwd, null, ctx.home) : null],
    ["Branch", branch],
    ["Status", phaseLabel],
    ...(children
      ? []
      : ([
          ["Model", info.model],
          ["Duration", duration ?? elapsed],
        ] as [string, string | null][])),
    [
      "Output",
      info.outputTokens > 0
        ? `${formatTokens(info.outputTokens)} tokens`
        : null,
    ],
  ];
  return (
    <aside
      aria-label="Session info"
      className="flex min-h-0 w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border/60 bg-sidebar/60 p-4"
    >
      <div className="flex items-center gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Session
        </span>
        <span className="ml-auto">
          <IconButton label="Hide session info" onClick={onClose}>
            <HugeiconsIcon icon={Cancel01Icon} size={12} />
          </IconButton>
        </span>
      </div>
      <div className="rounded-xl border border-border/60 bg-card p-3.5">
        <div className="text-[13.5px] font-semibold leading-snug text-foreground">
          {title}
        </div>
        <dl className="mt-2.5 flex flex-col gap-1.5 text-[12px]">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">{k}</dt>
                <dd
                  className="terax-reader-mono min-w-0 truncate text-foreground"
                  title={v ?? ""}
                >
                  {v}
                </dd>
              </div>
            ))}
        </dl>
      </div>
      {children}
      {!children && info.contextPercent !== null && (
        <div className="rounded-xl border border-border/60 bg-card p-3.5">
          <div className="mb-2 flex items-center text-[11px] font-semibold text-muted-foreground">
            Context window
            <span className="ml-auto tabular-nums text-foreground">
              {info.contextPercent}%
            </span>
          </div>
          <ContextMeter percent={info.contextPercent} wide />
          <div className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
            {formatTokens(info.contextUsed ?? 0)} of{" "}
            {formatTokens(info.contextWindow ?? 0)} tokens
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["Turns", stats.turns],
            ["Tool calls", stats.toolCalls],
            ["Errors", stats.errors],
          ] as const
        ).map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-border/60 bg-card px-2.5 py-2"
          >
            <div className="text-[17px] font-semibold tabular-nums text-foreground">
              {value}
            </div>
            <div className="text-[10.5px] text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-border/60 bg-card p-3.5">
        <div className="mb-2 text-[11px] font-semibold text-muted-foreground">
          Files changed · {stats.files.length}
        </div>
        {stats.files.length === 0 ? (
          <div className="text-[12px] text-muted-foreground">None yet</div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {stats.files.map((file) => (
              <li key={file} className="flex min-w-0">
                <FileChip path={file} ctx={ctx} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

export function FilterBar({
  filters,
  onFilters,
  onExpandAll,
}: {
  filters: ReaderFilters;
  onFilters: (f: ReaderFilters) => void;
  onExpandAll: (open: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <ToggleChip
        label="Tools"
        on={filters.tools}
        onToggle={() => onFilters({ ...filters, tools: !filters.tools })}
      />
      <ToggleChip
        label="Thinking"
        on={filters.thinking}
        onToggle={() => onFilters({ ...filters, thinking: !filters.thinking })}
      />
      <span className="mx-1 h-4 w-px bg-border/70" />
      <button
        type="button"
        onClick={() => onExpandAll(true)}
        className="h-7 rounded-lg px-2 text-[11.5px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        Expand all
      </button>
      <button
        type="button"
        onClick={() => onExpandAll(false)}
        className="h-7 rounded-lg px-2 text-[11.5px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        Collapse all
      </button>
    </div>
  );
}

/** Session length: first entry to now while working, else to the last entry. */
export function useSessionDuration(
  info: SessionInfo,
  live: boolean,
): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, [live]);
  if (info.startedAt === null) return null;
  const end = live ? Math.max(now, info.lastAt ?? now) : (info.lastAt ?? now);
  return formatDuration(end - info.startedAt) || null;
}

export function ContextMeter({
  percent,
  wide = false,
}: {
  percent: number;
  wide?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-block h-1.5 overflow-hidden rounded-full bg-muted/70",
        wide ? "w-full" : "w-14",
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 rounded-full",
          percent >= 90
            ? "bg-[var(--terminal-ansi-red)]"
            : percent >= 70
              ? "bg-agent-attention"
              : "bg-primary",
        )}
        style={{ width: `${Math.max(2, percent)}%` }}
      />
    </span>
  );
}
