import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  type GitCommitFileChange,
  type GitLogEntry,
  native,
} from "@/modules/ai/lib/native";
import { normalizeError } from "./GitHistoryUtils";
import { MAX_VISIBLE_LANES, railWidth } from "./GraphRail";
import {
  EMPTY_GRAPH_STATE,
  type GraphRow,
  type GraphState,
  layoutGraph,
} from "./lib/graph";
import { parseRemoteWebUrl, type RemoteWebInfo } from "./lib/remoteWebUrl";

const RAIL_RESERVED_PX = railWidth(MAX_VISIBLE_LANES);
// rail | sha | subject(capped) | spacer(absorbs slack) | author(hugs) | date | changes
const GRID_TEMPLATE = `${RAIL_RESERVED_PX + 4}px 60px minmax(0, 560px) minmax(12px, 1fr) minmax(140px, max-content) 96px 116px`;

const PAGE_SIZE = 30;
const ROW_HEIGHT = 32;
const TABLE_HEADER_HEIGHT = 24;
const NEAR_BOTTOM_PX = 240;
const FILES_CACHE_LIMIT = 16;

import {
  CenterPlaceholder,
  CommitDetail,
  type CommitFileDiffOpenInput,
  CommitRow,
  type FilesEntry,
} from "./GitHistoryCommitParts";

export type { CommitFileDiffOpenInput } from "./GitHistoryCommitParts";

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
