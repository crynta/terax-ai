import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  native,
  type GitCommitFileChange,
  type GitLogEntry,
} from "@/modules/ai/lib/native";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import {
  Copy01Icon,
  File02Icon,
  LinkSquare02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { GraphRail, MAX_VISIBLE_LANES, railWidth } from "./GraphRail";
import {
  EMPTY_GRAPH_STATE,
  layoutGraph,
  type GraphRow,
  type GraphState,
} from "./lib/graph";
import {
  commitWebUrl,
  hostLabel,
  parseRemoteWebUrl,
  type RemoteWebInfo,
} from "./lib/remoteWebUrl";

const RAIL_RESERVED_PX = railWidth(MAX_VISIBLE_LANES);
// rail | sha | subject(capped) | spacer(absorbs slack) | author(hugs) | date | changes
const GRID_TEMPLATE = `${RAIL_RESERVED_PX + 4}px 60px minmax(0, 560px) minmax(12px, 1fr) minmax(140px, max-content) 96px 116px`;

const PAGE_SIZE = 30;
const ROW_HEIGHT = 32;
const TABLE_HEADER_HEIGHT = 24;
const NEAR_BOTTOM_PX = 240;
const FILES_CACHE_LIMIT = 16;

type CommitFileDiffOpenInput = {
  repoRoot: string;
  sha: string;
  shortSha: string;
  subject: string;
  path: string;
  originalPath: string | null;
};

export type GitHistorySearchHandle = {
  setQuery: (query: string) => void;
  clearQuery: () => void;
};

type Props = {
  repoRoot: string;
  onOpenCommitFile: (input: CommitFileDiffOpenInput) => void;
  /** Lets the header search bar drive commit filtering for the active pane. */
  onSearchHandle?: (handle: GitHistorySearchHandle | null) => void;
};

type LoadStatus = "idle" | "initial" | "more" | "error";

type FilesEntry =
  | { state: "loading" }
  | { state: "loaded"; files: GitCommitFileChange[] }
  | { state: "error"; error: string };

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "";
  const res = normalized.slice(0, index);
  if (/^[A-Za-z]:$/.test(res)) return `${res}/`;
  return res;
}

function normalizeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown error";
}

function absoluteTime(secs: number): string {
  if (!secs) return "";
  return new Date(secs * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function authorInitials(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

const AUTHOR_TINTS = [
  "#7aa2f7", // soft blue
  "#bb9af7", // soft purple
  "#9ece6a", // soft green
  "#e0af68", // soft amber
  "#f7768e", // soft rose
  "#73daca", // soft teal
  "#ff9e64", // soft orange
  "#b4f9f8", // pale cyan
];

function authorTint(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return AUTHOR_TINTS[Math.abs(hash) % AUTHOR_TINTS.length];
}

function compactDate(secs: number): string {
  if (!secs) return "";
  const d = new Date(secs * 1000);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const month = d.toLocaleString(undefined, { month: "short" });
  const day = String(d.getDate()).padStart(2, "0");
  if (sameYear) {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${month} ${day}  ${hh}:${mm}`;
  }
  return `${month} ${day} ${d.getFullYear()}`;
}

function statusTone(code: string): string {
  switch (code.toUpperCase()) {
    case "A":
      return "text-emerald-600 dark:text-emerald-400";
    case "M":
      return "text-amber-600 dark:text-amber-300";
    case "D":
      return "text-rose-600 dark:text-rose-400";
    case "R":
    case "C":
      return "text-sky-600 dark:text-sky-300";
    default:
      return "text-muted-foreground";
  }
}

function highlight(text: string, query: string): ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-primary/25 px-0.5 text-foreground">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function GitHistoryPane({
  repoRoot,
  onOpenCommitFile,
  onSearchHandle,
}: Props) {
  const [commits, setCommits] = useState<GitLogEntry[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [endReached, setEndReached] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const deferredSearch = useDeferredValue(searchInput.trim());
  // Require at least 2 characters before filtering to avoid noisy single-char
  // matches and pointless full-list scans on every keystroke.
  const activeSearch = deferredSearch.length >= 2 ? deferredSearch : "";

  useEffect(() => {
    onSearchHandle?.({
      setQuery: (query: string) => setSearchInput(query),
      clearQuery: () => setSearchInput(""),
    });
    return () => onSearchHandle?.(null);
  }, [onSearchHandle]);
  const [openAnchor, setOpenAnchor] = useState<{
    sha: string;
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const [remoteWeb, setRemoteWeb] = useState<RemoteWebInfo | null>(null);
  const filesCacheRef = useRef(new Map<string, FilesEntry>());
  const [filesTick, setFilesTick] = useState(0);
  const bumpFiles = useCallback(() => setFilesTick((n) => n + 1), []);

  const requestIdRef = useRef(0);
  const inflightMoreRef = useRef(false);
  const filesInflightRef = useRef(new Set<string>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const graphCacheRef = useRef<{
    rows: GraphRow[];
    byCommit: Map<string, GraphRow>;
    tail: GraphState;
    firstSha: string | null;
    len: number;
    maxLaneCount: number;
  }>({
    rows: [],
    byCommit: new Map(),
    tail: EMPTY_GRAPH_STATE,
    firstSha: null,
    len: 0,
    maxLaneCount: 1,
  });

  const { graphByCommit, maxLaneCount } = useMemo(() => {
    const cache = graphCacheRef.current;
    if (commits.length === 0) {
      cache.rows = [];
      cache.byCommit = new Map();
      cache.tail = EMPTY_GRAPH_STATE;
      cache.firstSha = null;
      cache.len = 0;
      cache.maxLaneCount = 1;
      return { graphByCommit: cache.byCommit, maxLaneCount: 1 };
    }
    const firstSha = commits[0].sha;
    const canAppend =
      cache.firstSha === firstSha && commits.length >= cache.len;
    if (!canAppend) {
      const { rows, state } = layoutGraph(commits);
      const byCommit = new Map<string, GraphRow>();
      let max = 1;
      for (const row of rows) {
        byCommit.set(row.sha, row);
        if (row.laneCount > max) max = row.laneCount;
      }
      cache.rows = rows;
      cache.byCommit = byCommit;
      cache.tail = state;
      cache.firstSha = firstSha;
      cache.len = commits.length;
      cache.maxLaneCount = max;
      return { graphByCommit: byCommit, maxLaneCount: max };
    }
    if (commits.length > cache.len) {
      const delta = commits.slice(cache.len);
      const { rows: newRows, state } = layoutGraph(delta, cache.tail);
      let max = cache.maxLaneCount;
      for (const row of newRows) {
        cache.byCommit.set(row.sha, row);
        if (row.laneCount > max) max = row.laneCount;
      }
      cache.rows = cache.rows.concat(newRows);
      cache.tail = state;
      cache.len = commits.length;
      cache.maxLaneCount = max;
    }
    return { graphByCommit: cache.byCommit, maxLaneCount: cache.maxLaneCount };
  }, [commits]);
  const gridTemplate = GRID_TEMPLATE;

  const filtered = useMemo(() => {
    const q = activeSearch.toLowerCase();
    if (!q) return commits;
    return commits.filter((c) => {
      const subject = c.subject.toLowerCase();
      const author = c.author.toLowerCase();
      const email = c.authorEmail.toLowerCase();
      return (
        subject.includes(q) ||
        author.includes(q) ||
        email.includes(q) ||
        c.shortSha.includes(q)
      );
    });
  }, [commits, activeSearch]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    getItemKey: (index) => filtered[index]?.sha ?? index,
  });

  const loadInitial = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoadStatus("initial");
    setError(null);
    setEndReached(false);
    try {
      const entries = await native.gitLog(repoRoot, { limit: PAGE_SIZE });
      if (requestId !== requestIdRef.current) return;
      setCommits(entries);
      setLoadStatus("idle");
      if (entries.length < PAGE_SIZE) setEndReached(true);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(normalizeError(err));
      setLoadStatus("error");
    }
  }, [repoRoot]);

  const loadMore = useCallback(async () => {
    if (inflightMoreRef.current || endReached) return;
    if (loadStatus !== "idle") return;
    const last = commits[commits.length - 1];
    if (!last) return;
    inflightMoreRef.current = true;
    setLoadStatus("more");
    try {
      const entries = await native.gitLog(repoRoot, {
        limit: PAGE_SIZE,
        beforeSha: last.sha,
      });
      setCommits((prev) => {
        const seen = new Set(prev.map((c) => c.sha));
        const merged = [...prev];
        for (const e of entries) if (!seen.has(e.sha)) merged.push(e);
        return merged;
      });
      if (entries.length < PAGE_SIZE) setEndReached(true);
      setLoadStatus("idle");
    } catch (err) {
      setError(normalizeError(err));
      setLoadStatus("error");
    } finally {
      inflightMoreRef.current = false;
    }
  }, [commits, endReached, loadStatus, repoRoot]);

  useEffect(() => {
    filesInflightRef.current.clear();
    filesCacheRef.current.clear();
    bumpFiles();
    setCommits([]);
    setOpenAnchor(null);
    void loadInitial();
  }, [bumpFiles, loadInitial]);

  useEffect(() => {
    let cancelled = false;
    native
      .gitRemoteUrl(repoRoot)
      .then((url) => {
        if (cancelled) return;
        setRemoteWeb(parseRemoteWebUrl(url));
      })
      .catch(() => {
        if (cancelled) return;
        setRemoteWeb(null);
      });
    return () => {
      cancelled = true;
    };
  }, [repoRoot]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setOpenAnchor((prev) => (prev ? null : prev));
    if (activeSearch) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remaining < NEAR_BOTTOM_PX) {
      void loadMore();
    }
  }, [activeSearch, loadMore]);

  // Auto-fill: if the list doesn't fill the viewport (no scroll possible)
  // after a load, keep pulling pages until it does or the end is reached.
  // Scheduled async so we don't fight ongoing state transitions.
  useEffect(() => {
    if (loadStatus !== "idle") return;
    if (endReached) return;
    if (activeSearch) return;
    if (commits.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    const scrollable = el.scrollHeight - el.clientHeight;
    if (scrollable > NEAR_BOTTOM_PX) return;
    const id = window.setTimeout(() => {
      void loadMore();
    }, 0);
    return () => window.clearTimeout(id);
  }, [commits.length, activeSearch, endReached, loadMore, loadStatus]);

  const handleRefresh = useCallback(() => {
    filesInflightRef.current.clear();
    filesCacheRef.current.clear();
    bumpFiles();
    void loadInitial();
  }, [bumpFiles, loadInitial]);

  const fetchFiles = useCallback(
    async (sha: string) => {
      if (filesInflightRef.current.has(sha)) return;
      const cache = filesCacheRef.current;
      const existing = cache.get(sha);
      if (existing && existing.state !== "error") return;
      filesInflightRef.current.add(sha);
      cache.set(sha, { state: "loading" });
      bumpFiles();
      try {
        const files = await native.gitCommitFiles(repoRoot, sha);
        cache.set(sha, { state: "loaded", files });
        while (cache.size > FILES_CACHE_LIMIT) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined || oldest === sha) break;
          cache.delete(oldest);
        }
        bumpFiles();
      } catch (err) {
        cache.set(sha, { state: "error", error: normalizeError(err) });
        bumpFiles();
      } finally {
        filesInflightRef.current.delete(sha);
      }
    },
    [repoRoot],
  );

  const handleRowClick = useCallback(
    (sha: string, event: React.MouseEvent<HTMLElement>) => {
      if (openAnchor?.sha === sha) {
        setOpenAnchor(null);
        return;
      }
      // Anchor at the cursor so the popover opens where the user clicked,
      // but clamp X so it never gets pushed off-screen on the right.
      const POPOVER_WIDTH = 420;
      const PADDING = 16;
      const maxLeft = window.innerWidth - POPOVER_WIDTH - PADDING;
      const left = Math.max(PADDING, Math.min(event.clientX, maxLeft));
      setOpenAnchor({
        sha,
        top: event.clientY,
        left,
        width: 1,
        height: 1,
      });
      void fetchFiles(sha);
    },
    [fetchFiles, openAnchor?.sha],
  );

  const closePopover = useCallback(() => setOpenAnchor(null), []);

  const openFilesEntry = useMemo(() => {
    if (!openAnchor) return null;
    return filesCacheRef.current.get(openAnchor.sha) ?? null;
  }, [openAnchor, filesTick]);

  const handleFileOpen = useCallback(
    (commit: GitLogEntry, file: GitCommitFileChange) => {
      onOpenCommitFile({
        repoRoot,
        sha: commit.sha,
        shortSha: commit.shortSha,
        subject: commit.subject,
        path: file.path,
        originalPath: file.originalPath,
      });
      setOpenAnchor(null);
    },
    [onOpenCommitFile, repoRoot],
  );

  const copyToClipboard = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      /* noop */
    }
  }, []);

  return (
    <TooltipProvider delayDuration={500} skipDelayDuration={200}>
      <div className="flex h-full min-h-0 flex-col bg-background [contain:layout_style]">
        {loadStatus === "initial" && commits.length === 0 ? (
          <CenterPlaceholder>
            <Spinner className="size-4" />
            <span className="text-[11.5px] text-muted-foreground">
              Loading commits…
            </span>
          </CenterPlaceholder>
        ) : loadStatus === "error" && commits.length === 0 ? (
          <CenterPlaceholder>
            <div className="text-[13px] font-medium">
              Could not load history
            </div>
            <div className="max-w-md text-[11px] leading-relaxed text-muted-foreground">
              {error ?? "Unknown error"}
            </div>
            <Button size="sm" onClick={handleRefresh}>
              Retry
            </Button>
          </CenterPlaceholder>
        ) : commits.length === 0 ? (
          <CenterPlaceholder>
            <div className="text-[13px] font-medium">No commits yet</div>
            <div className="max-w-md text-[11px] leading-relaxed text-muted-foreground">
              This branch has no commits.
            </div>
          </CenterPlaceholder>
        ) : (
          <>
            <div
              className="grid shrink-0 items-center gap-3 border-b border-border/40 bg-card/55 pr-3 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70"
              style={{
                height: TABLE_HEADER_HEIGHT,
                gridTemplateColumns: gridTemplate,
              }}
            >
              <div />
              <div className="pl-px">SHA</div>
              <div className="min-w-0">Subject</div>
              <div />
              <div className="ml-2">Author</div>
              <div className="text-right">Date</div>
              <div className="text-right">Changes</div>
            </div>
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]"
            >
              <div
                style={{
                  height: virtualizer.getTotalSize(),
                  position: "relative",
                  width: "100%",
                }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const commit = filtered[virtualRow.index];
                  if (!commit) return null;
                  return (
                    <div
                      key={virtualRow.key}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: virtualRow.size,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <CommitRow
                        commit={commit}
                        query={activeSearch}
                        active={openAnchor?.sha === commit.sha}
                        graphRow={graphByCommit.get(commit.sha) ?? null}
                        maxLaneCount={maxLaneCount}
                        gridTemplate={gridTemplate}
                        onClick={handleRowClick}
                      />
                    </div>
                  );
                })}
              </div>

              {loadStatus === "more" ? (
                <div className="flex items-center justify-center gap-2 py-3 text-[11px] text-muted-foreground">
                  <Spinner className="size-3" />
                  Loading more…
                </div>
              ) : null}
              {endReached && !activeSearch ? (
                <div className="py-3 text-center text-[10.5px] text-muted-foreground/65">
                  End of history
                </div>
              ) : null}
              {loadStatus === "error" && commits.length > 0 ? (
                <div className="flex items-center justify-center gap-2 py-3 text-[11px] text-destructive">
                  {error ?? "Failed to load more"}
                  <Button
                    size="xs"
                    variant="ghost"
                    className="h-6 cursor-pointer text-[11px]"
                    onClick={() => void loadMore()}
                  >
                    Retry
                  </Button>
                </div>
              ) : null}
            </div>
          </>
        )}

        <Popover
          open={!!openAnchor}
          onOpenChange={(next) => {
            if (!next) closePopover();
          }}
        >
          {typeof document !== "undefined"
            ? createPortal(
                <PopoverAnchor asChild>
                  <div
                    aria-hidden
                    style={{
                      position: "fixed",
                      top: openAnchor?.top ?? -9999,
                      left: openAnchor?.left ?? -9999,
                      width: openAnchor?.width ?? 0,
                      height: openAnchor?.height ?? 0,
                      pointerEvents: "none",
                    }}
                  />
                </PopoverAnchor>,
                document.body,
              )
            : null}
          <PopoverContent
            side="bottom"
            align="start"
            sideOffset={4}
            alignOffset={0}
            collisionPadding={16}
            avoidCollisions
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="flex w-[420px] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-xl p-0 shadow-xl"
          >
            {openAnchor
              ? (() => {
                  const commit = commits.find((c) => c.sha === openAnchor.sha);
                  if (!commit) return null;
                  return (
                    <CommitDetail
                      commit={commit}
                      filesEntry={openFilesEntry}
                      remoteWeb={remoteWeb}
                      onCopySha={copyToClipboard}
                      onOpenFile={handleFileOpen}
                      onRetryFiles={() => void fetchFiles(openAnchor.sha)}
                    />
                  );
                })()
              : null}
          </PopoverContent>
        </Popover>
      </div>
    </TooltipProvider>
  );
}

function CenterPlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      {children}
    </div>
  );
}

type CommitRowProps = {
  commit: GitLogEntry;
  query: string;
  active: boolean;
  graphRow: GraphRow | null;
  maxLaneCount: number;
  gridTemplate: string;
  onClick: (sha: string, event: React.MouseEvent<HTMLElement>) => void;
};

const CommitRow = memo(function CommitRow({
  commit,
  query,
  active,
  graphRow,
  maxLaneCount,
  gridTemplate,
  onClick,
}: CommitRowProps) {
  const date = compactDate(commit.timestampSecs);
  const initials = authorInitials(commit.author);
  const totalStat = commit.insertions + commit.deletions;
  return (
    <button
      type="button"
      onClick={(event) => onClick(commit.sha, event)}
      className={cn(
        "group relative grid h-full w-full cursor-pointer items-center gap-3 border-l-2 border-transparent pr-3 text-left transition-colors",
        active ? "border-l-primary/70 bg-accent/45" : "hover:bg-accent/25",
      )}
      style={{ gridTemplateColumns: gridTemplate }}
    >
      <div className="flex items-center justify-start pl-1">
        {graphRow ? (
          <GraphRail
            row={graphRow}
            rowHeight={ROW_HEIGHT}
            maxLaneCount={maxLaneCount}
            active={active}
          />
        ) : null}
      </div>
      <span className="pl-px font-mono text-[10.5px] tabular-nums text-muted-foreground/80">
        {commit.shortSha}
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-[12px] leading-tight",
          active
            ? "font-semibold text-foreground"
            : "font-medium text-foreground/95",
        )}
      >
        {commit.subject ? (
          highlight(commit.subject, query)
        ) : (
          <span className="text-muted-foreground">(no subject)</span>
        )}
      </span>
      <span aria-hidden />
      <span
        className="ml-2 inline-flex h-[18px] max-w-full min-w-0 items-center gap-1.5 justify-self-start self-center overflow-hidden rounded-md bg-foreground/6 pl-1 pr-1.5 text-[10.5px] font-medium text-foreground/85"
        title={commit.authorEmail || commit.author}
      >
        <span
          className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-[3px] font-mono text-[8.5px] font-bold uppercase tabular-nums text-background"
          style={{
            backgroundColor: authorTint(commit.authorEmail || commit.author),
          }}
        >
          {initials}
        </span>
        <span className="min-w-0 truncate">
          {commit.author ? highlight(commit.author, query) : "Unknown"}
        </span>
      </span>
      <span className="text-right font-mono text-[10.5px] tabular-nums text-muted-foreground/75">
        {date}
      </span>
      <span className="flex min-w-0 items-center justify-end gap-1.5 font-mono text-[10px] tabular-nums">
        {commit.filesChanged > 0 ? (
          <span
            className="inline-flex items-center gap-1 text-muted-foreground/75"
            title={`${commit.filesChanged} ${commit.filesChanged === 1 ? "file" : "files"} changed`}
          >
            <HugeiconsIcon
              icon={File02Icon}
              size={10.5}
              strokeWidth={1.7}
              className="opacity-70"
            />
            <span className="font-medium">{commit.filesChanged}</span>
          </span>
        ) : null}
        {commit.filesChanged > 0 && totalStat > 0 ? (
          <span
            aria-hidden
            className="size-[3px] shrink-0 rounded-full bg-muted-foreground/30"
          />
        ) : null}
        {totalStat > 0 ? (
          <span className="inline-flex items-center gap-1">
            {commit.insertions > 0 ? (
              <span className="font-semibold text-emerald-600/85 dark:text-emerald-400/85">
                +{commit.insertions}
              </span>
            ) : null}
            {commit.deletions > 0 ? (
              <span className="font-semibold text-rose-600/85 dark:text-rose-400/85">
                −{commit.deletions}
              </span>
            ) : null}
          </span>
        ) : commit.filesChanged === 0 ? (
          <span className="text-muted-foreground/40">—</span>
        ) : null}
      </span>
    </button>
  );
});

type CommitDetailProps = {
  commit: GitLogEntry;
  filesEntry: FilesEntry | null;
  remoteWeb: RemoteWebInfo | null;
  onCopySha: (value: string) => Promise<void> | void;
  onOpenFile: (
    commit: GitLogEntry,
    file: GitCommitFileChange,
  ) => Promise<void> | void;
  onRetryFiles: () => void;
};

function CommitDetail({
  commit,
  filesEntry,
  remoteWeb,
  onCopySha,
  onOpenFile,
  onRetryFiles,
}: CommitDetailProps) {
  const absolute = absoluteTime(commit.timestampSecs);
  const webUrl = remoteWeb ? commitWebUrl(remoteWeb, commit.sha) : null;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1100);
    return () => window.clearTimeout(t);
  }, [copied]);

  return (
    <div className="flex max-h-[60vh] min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/45 p-3">
        <div className="flex items-start gap-2">
          <span className="mt-px shrink-0 rounded bg-muted/65 px-1.5 py-0.5 font-mono text-[10.5px] leading-none tabular-nums text-muted-foreground">
            {commit.shortSha}
          </span>
          <div className="min-w-0 flex-1 text-[12.5px] font-semibold leading-snug text-foreground">
            {commit.subject || (
              <span className="text-muted-foreground">(no subject)</span>
            )}
          </div>
        </div>
        <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <span className="truncate">{commit.author || "Unknown"}</span>
          {commit.authorEmail ? (
            <>
              <span className="text-muted-foreground/45">·</span>
              <span className="truncate text-muted-foreground/85">
                {commit.authorEmail}
              </span>
            </>
          ) : null}
          <span className="text-muted-foreground/45">·</span>
          <span className="shrink-0 tabular-nums">{absolute}</span>
        </div>

        <div className="mt-2.5 flex items-center gap-1">
          <Button
            size="xs"
            variant="ghost"
            className="h-6 cursor-pointer gap-1.5 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => {
              void onCopySha(commit.sha);
              setCopied(true);
            }}
          >
            <HugeiconsIcon icon={Copy01Icon} size={11} strokeWidth={1.9} />
            {copied ? "Copied" : "Copy SHA"}
          </Button>
          {webUrl ? (
            <Button
              size="xs"
              variant="ghost"
              className="h-6 cursor-pointer gap-1.5 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => void openUrl(webUrl).catch(console.error)}
            >
              <HugeiconsIcon
                icon={LinkSquare02Icon}
                size={11}
                strokeWidth={1.9}
              />
              {hostLabel(remoteWeb!)}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CommitFiles
          commit={commit}
          filesEntry={filesEntry}
          onOpenFile={onOpenFile}
          onRetry={onRetryFiles}
        />
      </div>
    </div>
  );
}

function CommitFiles({
  commit,
  filesEntry,
  onOpenFile,
  onRetry,
}: {
  commit: GitLogEntry;
  filesEntry: FilesEntry | null;
  onOpenFile: (
    commit: GitLogEntry,
    file: GitCommitFileChange,
  ) => Promise<void> | void;
  onRetry: () => void;
}) {
  if (!filesEntry || filesEntry.state === "loading") {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted-foreground">
        <Spinner className="size-3" />
        Loading files…
      </div>
    );
  }
  if (filesEntry.state === "error") {
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-3 text-[11px] text-destructive">
        <span className="truncate">{filesEntry.error}</span>
        <Button
          size="xs"
          variant="ghost"
          className="h-6 cursor-pointer text-[11px]"
          onClick={onRetry}
        >
          Retry
        </Button>
      </div>
    );
  }
  if (filesEntry.files.length === 0) {
    return (
      <div className="px-3 py-3 text-[11px] text-muted-foreground">
        No file changes.
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/85">
        <span>Files</span>
        <span className="rounded-sm bg-muted/55 px-1 py-px text-[9.5px] tabular-nums text-muted-foreground/85 normal-case tracking-normal">
          {filesEntry.files.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]">
        <ul className="space-y-px px-1.5 pb-2">
          {filesEntry.files.map((file) => (
            <li key={file.path}>
              <FileRow
                file={file}
                onOpen={() => void onOpenFile(commit, file)}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const FileRow = memo(function FileRow({
  file,
  onOpen,
}: {
  file: GitCommitFileChange;
  onOpen: () => void;
}) {
  const fileName = basename(file.path);
  const dir = dirname(file.path);
  const iconUrl = fileIconUrl(fileName);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-accent/40"
    >
      {iconUrl ? (
        <img src={iconUrl} alt="" className="size-3.5 shrink-0" />
      ) : (
        <span className="size-3.5 shrink-0" />
      )}
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5 leading-none">
        <span className="truncate text-[11.5px] font-medium leading-tight">
          {fileName}
        </span>
        {dir ? (
          <span className="min-w-0 flex-1 truncate text-[10px] leading-tight text-muted-foreground/80">
            {dir}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1 text-[10px] tabular-nums">
        {file.isBinary ? (
          <span className="text-muted-foreground/70">binary</span>
        ) : (
          <>
            {file.added > 0 ? (
              <span className="text-emerald-600 dark:text-emerald-400">
                +{file.added}
              </span>
            ) : null}
            {file.removed > 0 ? (
              <span className="text-rose-600 dark:text-rose-400">
                −{file.removed}
              </span>
            ) : null}
          </>
        )}
      </div>
      <span
        className={cn(
          "inline-flex w-4 shrink-0 justify-center text-[9.5px] font-bold leading-none tabular-nums",
          statusTone(file.status),
        )}
        title={file.statusLabel}
      >
        {file.status.toUpperCase()}
      </span>
    </button>
  );
});
