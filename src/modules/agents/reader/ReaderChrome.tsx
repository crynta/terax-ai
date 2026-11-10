import { useGitBranch } from "@/app/components/useGitBranch";
import { cn } from "@/lib/utils";
import {
  BubbleChatIcon,
  Cancel01Icon,
  DashboardSquare01Icon,
  PinIcon,
  PinOffIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type PinnedTurn, pinsInOrder } from "./lib/pinnedTurns";
import { matchesQuery } from "./lib/promptSearch";
import type { OutlineItem, SessionStats } from "./lib/readerDoc";
import { displayPath, formatClock, formatDuration } from "./lib/readerView";
import { formatTokens, type SessionInfo } from "./lib/sessionInfo";
import { FileChip, type ReaderContext } from "./ReaderBlocks";

/**
 * A Reader header tool: a large icon, with its name beside it when the
 * header is wide enough. `badge` counts something; `dot` marks a status.
 */
export function HeaderButton({
  icon,
  label,
  title,
  active,
  badge,
  dot,
  className,
  ...rest
}: {
  icon: typeof PinIcon;
  label: string;
  title?: string;
  /** A toggle's state; leave out for a plain button. */
  active?: boolean;
  badge?: number;
  /** A status dot before the name (the Session button's state). */
  dot?: ReactNode;
} & Omit<ComponentProps<"button">, "children" | "title">) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      aria-pressed={active}
      className={cn(
        "relative flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.07] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-40 data-[state=open]:bg-primary/15 data-[state=open]:text-foreground",
        active && "bg-primary/15 text-foreground hover:bg-primary/20",
        className,
      )}
      {...rest}
    >
      <HugeiconsIcon icon={icon} size={17} strokeWidth={1.8} />
      {dot}
      <span className="hidden @[60rem]/reader:inline">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9.5px] font-semibold tabular-nums text-primary-foreground @[60rem]/reader:static @[60rem]/reader:h-[18px] @[60rem]/reader:min-w-[18px] @[60rem]/reader:text-[10.5px]">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

/** The top row of a Reader side panel: icon, name, a count and Close. */
export function PanelHeader({
  icon,
  title,
  detail,
  onClose,
}: {
  icon: typeof PinIcon;
  title: string;
  detail?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2.5">
      <HugeiconsIcon
        icon={icon}
        size={14}
        strokeWidth={1.8}
        className="text-primary"
      />
      <span className="text-[12.5px] font-semibold text-foreground">
        {title}
      </span>
      {detail !== undefined && (
        <span className="text-[11.5px] tabular-nums text-muted-foreground">
          {detail}
        </span>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label={`Close ${title.toLowerCase()}`}
        title="Close (Esc)"
        className="ml-auto grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} />
      </button>
    </div>
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

type ChatsTab = "pinned" | "all";

/**
 * The Chats panel: this session's turns as "Pinned" (the default when there
 * are any) and "All", filtered by the search box. Picking one jumps to it,
 * paging back through the chat when it isn't loaded.
 */
export function ChatsPanel({
  items,
  current,
  onPick,
  pins,
  onUnpin,
  onTogglePin,
  onClose,
}: {
  /** Every turn of the session, oldest first (see `chatList`). */
  items: readonly OutlineItem[];
  current: string | null;
  onPick: (id: string) => void;
  pins: readonly PinnedTurn[];
  onUnpin: (id: string) => void;
  /** Pins or unpins a turn from the "All" list; absent when it can't be pinned. */
  onTogglePin?: (item: OutlineItem) => void;
  onClose: () => void;
}) {
  const list = useRef<HTMLOListElement | null>(null);
  const [chosen, setChosen] = useState<ChatsTab | null>(null);
  const [query, setQuery] = useState("");
  const tab: ChatsTab = chosen ?? (pins.length > 0 ? "pinned" : "all");
  const pinnedIds = useMemo(() => new Set(pins.map((p) => p.id)), [pins]);
  const byId = useMemo(
    () => new Map(items.map((item, n) => [item.id, { item, n: n + 1 }])),
    [items],
  );
  const shownItems = useMemo(
    () =>
      items
        .map((item, n) => ({ item, n: n + 1 }))
        .filter(({ item }) => matchesQuery(item.text, query)),
    [items, query],
  );
  const shownPins = useMemo(
    () =>
      pinsInOrder(pins).filter((pin) =>
        matchesQuery(byId.get(pin.id)?.item.text ?? pin.summary, query),
      ),
    [pins, byId, query],
  );
  useEffect(() => {
    if (!current || tab !== "all" || query) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-outline-id="${CSS.escape(current)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current, tab, query]);
  const filtering = query.trim() !== "";
  const tabButton = (id: ChatsTab, label: string, count: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setChosen(id)}
      className={cn(
        "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
        tab === id
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {id === "pinned" && (
        <HugeiconsIcon
          icon={PinIcon}
          size={13}
          strokeWidth={2}
          className={tab === id ? "text-primary" : undefined}
        />
      )}
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
  return (
    <section aria-label="Chats" className="flex min-h-0 flex-1 flex-col">
      <PanelHeader
        icon={BubbleChatIcon}
        title="Chats"
        detail={`${items.length} turn${items.length === 1 ? "" : "s"}`}
        onClose={onClose}
      />
      <div className="flex shrink-0 flex-col gap-2 px-3 pt-3 pb-2">
        <div
          role="tablist"
          aria-label="Turn list"
          className="flex gap-1 rounded-lg bg-foreground/[0.05] p-0.5"
        >
          {tabButton("pinned", "Pinned", shownPins.length)}
          {tabButton("all", "All", shownItems.length)}
        </div>
        <label className="flex h-8 items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-2.5 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20">
          <HugeiconsIcon
            icon={Search01Icon}
            size={13}
            strokeWidth={1.9}
            className="shrink-0 text-muted-foreground"
          />
          <input
            // biome-ignore lint/a11y/noAutofocus: the panel opens to find a turn
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                if (query) setQuery("");
                else onClose();
              }
            }}
            placeholder={
              tab === "pinned" ? "Search pinned turns" : "Search all turns"
            }
            aria-label="Search turns"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/80"
          />
        </label>
      </div>
      <ol ref={list} className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {tab === "pinned" ? (
          shownPins.length === 0 ? (
            <li className="px-2.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
              {filtering
                ? "No pinned turns match."
                : "No pinned turns yet. Press Pin on a turn, or the pin beside it under All, to keep it here."}
            </li>
          ) : (
            shownPins.map((pin) => {
              const n = byId.get(pin.id)?.n;
              return (
                <li key={pin.id} className="group/pin relative">
                  <button
                    type="button"
                    data-outline-id={pin.id}
                    aria-current={pin.id === current}
                    onClick={() => onPick(pin.id)}
                    className="terax-reader-outline-item flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 pr-10 text-left text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <span className="flex items-center gap-1.5 text-[10.5px] tabular-nums">
                      <HugeiconsIcon
                        icon={PinIcon}
                        size={11}
                        strokeWidth={2}
                        className="text-primary"
                      />
                      {n !== undefined && (
                        <span className="font-semibold text-primary/90">
                          {n}
                        </span>
                      )}
                      {formatClock(pin.at) && (
                        <span>{formatClock(pin.at)}</span>
                      )}
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
                    className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-md bg-primary/15 text-primary outline-none transition-colors hover:bg-primary/25 focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <HugeiconsIcon
                      icon={PinOffIcon}
                      size={14}
                      strokeWidth={2}
                    />
                  </button>
                </li>
              );
            })
          )
        ) : shownItems.length === 0 ? (
          <li className="px-2.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
            {filtering ? "No turns match." : "No turns yet."}
          </li>
        ) : (
          shownItems.map(({ item, n }) => (
            <li key={item.id} className="group/pin relative">
              <button
                type="button"
                data-outline-id={item.id}
                aria-current={item.id === current}
                onClick={() => onPick(item.id)}
                className={cn(
                  "terax-reader-outline-item group flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40",
                  onTogglePin && "pr-10",
                )}
              >
                <span className="flex items-center gap-1.5 text-[10.5px] tabular-nums">
                  <span className="font-semibold text-primary/90">{n}</span>
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
                  <HugeiconsIcon icon={PinIcon} size={14} strokeWidth={2} />
                </button>
              )}
            </li>
          ))
        )}
      </ol>
    </section>
  );
}

/**
 * The Session panel: what the session is (folder, branch, status), its
 * facts card, counts, the files it changed, and its plan and to-dos.
 */
export function SessionPanel({
  title,
  cwd,
  phaseLabel,
  stats,
  info,
  ctx,
  onClose,
  children,
}: {
  title: string;
  cwd: string | null;
  phaseLabel: string | null;
  stats: SessionStats;
  info: SessionInfo;
  ctx: ReaderContext;
  onClose: () => void;
  /** The session facts card, then the plan and to-dos. */
  children?: ReactNode;
}) {
  const branch = useGitBranch(cwd);
  const rows: [string, string | null][] = [
    ["Folder", cwd ? displayPath(cwd, null, ctx.home) : null],
    ["Branch", branch],
    ["Status", phaseLabel],
    [
      "Output",
      info.outputTokens > 0
        ? `${formatTokens(info.outputTokens)} tokens`
        : null,
    ],
  ];
  return (
    <section aria-label="Session" className="flex min-h-0 flex-1 flex-col">
      <PanelHeader
        icon={DashboardSquare01Icon}
        title="Session"
        onClose={onClose}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
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
      </div>
    </section>
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
