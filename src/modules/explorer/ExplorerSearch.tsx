import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Folder01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { motion } from "motion/react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { fileIconUrl } from "./lib/iconResolver";
import { copyToClipboard, revealInFinder } from "./lib/contextActions";
import { COMPACT_CONTENT, COMPACT_ITEM } from "./lib/menuItemClass";
import { cn } from "@/lib/utils";

type SearchHit = {
  path: string;
  rel: string;
  name: string;
  is_dir: boolean;
};

type SearchResult = {
  hits: SearchHit[];
  truncated: boolean;
  scanned: number;
  elapsed_ms: number;
  budget_exhausted: boolean;
  partial_reason: string | null;
};

type GrepHit = {
  path: string;
  rel: string;
  line: number;
  text: string;
};

type GrepResult = {
  hits: GrepHit[];
  truncated: boolean;
  files_scanned: number;
};

type SearchTab = "files" | "text";

const MIN_QUERY_LEN = 2;
const DEEP_QUERY_MIN_LEN = 6;
const SNIPPET_WINDOW = 40;

type Props = {
  rootPath: string;
  onOpenFile: (path: string, pin?: boolean) => void;
  onOpenTextHit: (
    path: string,
    line: number,
    query: string,
    caseSensitive: boolean,
    exactWord: boolean,
  ) => void;
  onRevealPath?: (path: string) => void;
  open: boolean;
  onRequestClose: () => void;
  onActiveChange?: (active: boolean) => void;
  onRevealInTerminal?: (path: string) => void;
  onAttachToAgent?: (path: string) => void;
};

export type ExplorerSearchHandle = {
  focus: () => void;
  isFocused: () => boolean;
};

function parsePatterns(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findSnippetStart(text: string, query: string, caseSensitive: boolean, exactWord: boolean): number {
  if (!query) return 0;
  const flags = caseSensitive ? "g" : "gi";
  const pat = exactWord ? `\\b${escapeRegex(query)}\\b` : escapeRegex(query);
  const re = new RegExp(pat, flags);
  const m = re.exec(text);
  if (!m || typeof m.index !== "number") return 0;
  return Math.max(0, m.index - SNIPPET_WINDOW);
}

function buildSnippet(text: string, query: string, caseSensitive: boolean, exactWord: boolean): string {
  if (!text) return "";
  const start = findSnippetStart(text, query, caseSensitive, exactWord);
  const end = Math.min(text.length, start + SNIPPET_WINDOW * 2);
  const body = text.slice(start, end);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${body}${suffix}`;
}

function splitWithHighlight(snippet: string, query: string, caseSensitive: boolean, exactWord: boolean): Array<{ text: string; hit: boolean }> {
  if (!query || !snippet) return [{ text: snippet, hit: false }];
  const flags = caseSensitive ? "g" : "gi";
  const pat = exactWord ? `\\b${escapeRegex(query)}\\b` : escapeRegex(query);
  const re = new RegExp(pat, flags);
  const parts: Array<{ text: string; hit: boolean }> = [];
  let last = 0;
  for (const m of snippet.matchAll(re)) {
    const idx = m.index ?? -1;
    if (idx < 0) continue;
    if (idx > last) parts.push({ text: snippet.slice(last, idx), hit: false });
    parts.push({ text: m[0], hit: true });
    last = idx + m[0].length;
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), hit: false });
  return parts.length > 0 ? parts : [{ text: snippet, hit: false }];
}

export const ExplorerSearch = forwardRef<ExplorerSearchHandle, Props>(function ExplorerSearch(
  {
    rootPath,
    onOpenFile,
    onOpenTextHit,
    onRevealPath,
    open,
    onRequestClose,
    onActiveChange,
    onRevealInTerminal,
    onAttachToAgent,
  }: Props,
  ref,
) {
  const showHidden = usePreferencesStore((s) => s.showHidden);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [tab, setTab] = useState<SearchTab>("files");
  const [submittedTab, setSubmittedTab] = useState<SearchTab>("files");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [exactWord, setExactWord] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [includeRaw, setIncludeRaw] = useState("");
  const [excludeRaw, setExcludeRaw] = useState("");
  const [submittedCaseSensitive, setSubmittedCaseSensitive] = useState(false);
  const [submittedExactWord, setSubmittedExactWord] = useState(false);
  const [submittedIncludeRaw, setSubmittedIncludeRaw] = useState("");
  const [submittedExcludeRaw, setSubmittedExcludeRaw] = useState("");
  const [runNonce, setRunNonce] = useState(0);
  const [fileResults, setFileResults] = useState<SearchHit[]>([]);
  const [textResults, setTextResults] = useState<GrepHit[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [deepBlocked, setDeepBlocked] = useState(false);
  const [runningDeep, setRunningDeep] = useState(false);
  const [partialReason, setPartialReason] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastKeyboardNavAt = useRef(0);
  const requestId = useRef(0);
  const forceDeepRef = useRef(false);

  const active = submittedQuery.trim().length > 0;
  const visibleCount = tab === "files" ? fileResults.length : textResults.length;

  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    const q = submittedQuery.trim();
    if (q.length < MIN_QUERY_LEN || runNonce === 0) {
      return;
    }

    const includePaths = parsePatterns(submittedIncludeRaw);
    const excludePaths = parsePatterns(submittedExcludeRaw);
    const id = ++requestId.current;
    const forceDeep = forceDeepRef.current;
    forceDeepRef.current = false;
    setSearching(true);
    setDeepBlocked(false);
    setRunningDeep(false);
    setPartialReason(null);

    const runPass = async (mode: "fast" | "deep") => {
      if (submittedTab === "files") {
        return invoke<SearchResult>("fs_search", {
          root: rootPath,
          query: q,
          limit: 100,
          showHidden,
          workspace: currentWorkspaceEnv(),
          includePaths,
          excludePaths,
          passMode: mode,
          pruneHeavy: mode === "fast",
          deepBudgetProfile: mode === "deep" && forceDeep ? "wide" : "strict",
          requestId: id,
        });
      }
      const pattern = submittedExactWord ? `\\b${escapeRegex(q)}\\b` : escapeRegex(q);
      return invoke<GrepResult>("fs_grep", {
        pattern,
        root: rootPath,
        caseInsensitive: !submittedCaseSensitive,
        maxResults: 100,
        workspace: currentWorkspaceEnv(),
        includePaths,
        excludePaths,
        passMode: mode,
      });
    };

    void (async () => {
      try {
        const fast = await runPass("fast");
        if (id !== requestId.current) return;
        let finalRes = fast;
        if (fast.truncated) {
          const allowAutoDeep = q.length >= DEEP_QUERY_MIN_LEN;
          if (forceDeep || allowAutoDeep) {
            setRunningDeep(true);
            finalRes = await runPass("deep");
            if (id !== requestId.current) return;
          } else {
            setDeepBlocked(tab === "text");
          }
        }
        if (submittedTab === "files") {
          const raw = (finalRes as SearchResult).hits;
          const needle = submittedCaseSensitive ? q : q.toLowerCase();
          const exact = submittedExactWord
            ? new RegExp(`\\b${escapeRegex(q)}\\b`, submittedCaseSensitive ? "" : "i")
            : null;
          const filtered = raw.filter((h) => {
            const rel = submittedCaseSensitive ? h.rel : h.rel.toLowerCase();
            const abs = submittedCaseSensitive ? h.path : h.path.toLowerCase();
            if (exact) return exact.test(h.rel) || exact.test(h.path);
            return rel.includes(needle) || abs.includes(needle);
          });
          setFileResults(filtered);
          setTextResults([]);
        } else {
          setTextResults((finalRes as GrepResult).hits);
          setFileResults([]);
        }
        setTruncated(finalRes.truncated);
        if (submittedTab === "files") {
          setPartialReason((finalRes as SearchResult).partial_reason ?? null);
        }
        setSelectedIndex(0);
      } catch (e) {
        if (id !== requestId.current) return;
        console.error("explorer search failed:", e);
        setFileResults([]);
        setTextResults([]);
        setTruncated(false);
        setPartialReason(null);
        setSelectedIndex(0);
      } finally {
        if (id === requestId.current) {
          setSearching(false);
          setRunningDeep(false);
        }
      }
    })();
  }, [
    rootPath,
    runNonce,
    showHidden,
    submittedExcludeRaw,
    submittedIncludeRaw,
    submittedCaseSensitive,
    submittedExactWord,
    submittedQuery,
    submittedTab,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        requestAnimationFrame(() => {
          inputRef.current?.focus();
        });
      },
      isFocused: () => document.activeElement === inputRef.current,
    }),
    [],
  );

  useEffect(() => {
    if (active && visibleCount > 0) {
      const el = scrollRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, visibleCount, active]);

  const handleSelect = (index: number) => {
    if (tab === "files") {
      const hit = fileResults[index];
      if (!hit || hit.is_dir) return;
      onRevealPath?.(hit.path);
      onOpenFile(hit.path, false);
      return;
    }
    const hit = textResults[index];
    if (!hit) return;
    onRevealPath?.(hit.path);
    onOpenTextHit(
      hit.path,
      hit.line,
      submittedQuery,
      submittedCaseSensitive,
      submittedExactWord,
    );
  };

  const submitSearch = () => {
    const nextQuery = query.trim();
    if (nextQuery.length < MIN_QUERY_LEN) return false;
    setSubmittedTab(tab);
    setSubmittedQuery(nextQuery);
    setSubmittedCaseSensitive(caseSensitive);
    setSubmittedExactWord(exactWord);
    setSubmittedIncludeRaw(includeRaw);
    setSubmittedExcludeRaw(excludeRaw);
    setRunNonce((n) => n + 1);
    return true;
  };

  const hasUnsubmittedChanges =
    query.trim() !== submittedQuery ||
    caseSensitive !== submittedCaseSensitive ||
    exactWord !== submittedExactWord ||
    includeRaw !== submittedIncludeRaw ||
    excludeRaw !== submittedExcludeRaw;

  const runDeepAnyway = () => {
    forceDeepRef.current = true;
    setRunNonce((n) => n + 1);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {open ? (
        <motion.div
          className="shrink-0 border-b border-border/60 px-2 py-1.5"
          initial={{ opacity: 0, transform: "translateY(-15px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
        >
          <div className="mb-1 flex items-center gap-1">
            <button
              type="button"
              className={cn(
                "h-6 rounded px-2 text-xs",
                tab === "files" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setTab("files")}
            >
              Files
            </button>
            <button
              type="button"
              className={cn(
                "h-6 rounded px-2 text-xs",
                tab === "text" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setTab("text")}
            >
              Text
            </button>
          </div>
          <div className="relative">
            <HugeiconsIcon
              icon={Search01Icon}
              size={13}
              strokeWidth={2}
              className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  onRequestClose();
                  return;
                }
                if (visibleCount > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    lastKeyboardNavAt.current = Date.now();
                    setSelectedIndex((prev) => (prev + 1) % visibleCount);
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    lastKeyboardNavAt.current = Date.now();
                    setSelectedIndex((prev) => (prev - 1 + visibleCount) % visibleCount);
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    if (hasUnsubmittedChanges) submitSearch();
                    else handleSelect(selectedIndex);
                  }
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  submitSearch();
                }
              }}
              placeholder={tab === "files" ? "Search files..." : "Search file contents..."}
              className="h-7 pr-24 pl-6.5 text-[11px] placeholder:text-muted-foreground/45"
            />
            <div className="absolute top-1/2 right-7 flex -translate-y-1/2 items-center gap-0.5">
              <button
                type="button"
                aria-label="Toggle case sensitive"
                title="Case sensitive"
                onClick={() => setCaseSensitive((v) => !v)}
                className={cn(
                  "rounded px-1 py-0.5 text-[9px] font-medium",
                  caseSensitive ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                Aa
              </button>
              <button
                type="button"
                aria-label="Toggle exact word"
                title="Exact word"
                onClick={() => setExactWord((v) => !v)}
                className={cn(
                  "rounded px-1 py-0.5 text-[9px] font-medium",
                  exactWord ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                W
              </button>
            </div>
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Clear search"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
              </button>
            ) : null}
          </div>
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              className="flex h-6 w-full items-center gap-1 rounded px-1 text-[11px] text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              aria-expanded={filtersOpen}
            >
              <HugeiconsIcon
                icon={filtersOpen ? ArrowDown01Icon : ArrowRight01Icon}
                size={10}
                strokeWidth={2}
              />
              Filters
            </button>
            {filtersOpen ? (
              <div className="mt-1 space-y-1">
                <Input
                  value={includeRaw}
                  onChange={(e) => setIncludeRaw(e.target.value)}
                  placeholder="Include globs"
                  className="h-6 text-[10px] text-muted-foreground/70 placeholder:text-muted-foreground/45"
                />
                <Input
                  value={excludeRaw}
                  onChange={(e) => setExcludeRaw(e.target.value)}
                  placeholder="Exclude globs"
                  className="h-6 text-[10px] text-muted-foreground/70 placeholder:text-muted-foreground/45"
                />
              </div>
            ) : null}
          </div>
        </motion.div>
      ) : null}

      {active ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="relative py-1" ref={scrollRef}>
            {tab === "text" ? (
              <div
                className="pointer-events-none absolute top-0 right-0 bottom-0 w-px bg-border/60"
                aria-hidden
              />
            ) : null}
            {searching && visibleCount === 0 ? (
              <div className="px-3 py-2 text-[11px] text-muted-foreground">Searching...</div>
            ) : visibleCount === 0 ? (
              <div className="px-3 py-2 text-[11px] text-muted-foreground">No matches</div>
            ) : tab === "files" ? (
              fileResults.map((hit, index) => {
                const url = hit.is_dir ? null : fileIconUrl(hit.name);
                const isSelected = index === selectedIndex;
                return (
                  <ContextMenu key={hit.path}>
                    <ContextMenuTrigger asChild>
                      <button
                        type="button"
                        data-index={index}
                        onClick={() => handleSelect(index)}
                        onMouseEnter={() => {
                          if (Date.now() - lastKeyboardNavAt.current > 250) setSelectedIndex(index);
                        }}
                        className={cn(
                          "flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs transition-colors",
                          isSelected ? "bg-accent text-foreground" : "text-foreground/80 hover:bg-accent/50",
                        )}
                        title={hit.path}
                      >
                        {url ? (
                          <img src={url} alt="" className="size-3.5 shrink-0" />
                        ) : (
                          <HugeiconsIcon
                            icon={Folder01Icon}
                            size={13}
                            strokeWidth={1.75}
                            className="shrink-0 text-muted-foreground"
                          />
                        )}
                        <span className="truncate">{hit.name}</span>
                        <span className="ml-auto truncate text-[10px] text-muted-foreground">{hit.rel}</span>
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent className={COMPACT_CONTENT}>
                      {!hit.is_dir && (
                        <ContextMenuItem className={COMPACT_ITEM} onSelect={() => onOpenFile(hit.path, true)}>
                          Open
                        </ContextMenuItem>
                      )}
                      {hit.is_dir && onRevealInTerminal && (
                        <ContextMenuItem className={COMPACT_ITEM} onSelect={() => onRevealInTerminal(hit.path)}>
                          Open in Terminal
                        </ContextMenuItem>
                      )}
                      <ContextMenuItem className={COMPACT_ITEM} onSelect={() => void revealInFinder(hit.path)}>
                        Reveal in Finder
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem className={COMPACT_ITEM} onSelect={() => void copyToClipboard(hit.path)}>
                        Copy Path
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem className={COMPACT_ITEM} onSelect={() => onAttachToAgent?.(hit.path)}>
                        Attach to Agent
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })
            ) : (
              textResults.map((hit, index) => {
                const isSelected = index === selectedIndex;
                const snippet = buildSnippet(
                  hit.text,
                  submittedQuery,
                  submittedCaseSensitive,
                  submittedExactWord,
                );
                const parts = splitWithHighlight(
                  snippet,
                  submittedQuery,
                  submittedCaseSensitive,
                  submittedExactWord,
                );
                return (
                  <button
                    key={`${hit.path}:${hit.line}:${index}`}
                    type="button"
                    data-index={index}
                    onMouseDown={(e) => {
                      // Keep this row behaving like a single clickable item,
                      // not a text-selection target.
                      e.preventDefault();
                    }}
                    onClick={() => handleSelect(index)}
                    onMouseEnter={() => {
                      if (Date.now() - lastKeyboardNavAt.current > 250) setSelectedIndex(index);
                    }}
                    className={cn(
                      "flex w-full cursor-pointer select-none flex-col items-start gap-0.5 py-1.5 pr-0 pl-2 text-left text-[11px] transition-colors",
                      isSelected ? "bg-accent text-foreground" : "text-foreground/80 hover:bg-accent/50",
                    )}
                    title={`${hit.path}:${hit.line}`}
                  >
                    <div className="relative w-full">
                      <span className="block min-w-0 truncate pr-[210px] font-medium">
                        {hit.rel}
                      </span>
                      <span
                        className="absolute top-0 right-0 w-[200px] min-w-[88px] truncate text-right text-[10px] text-muted-foreground"
                        dir="rtl"
                        title={`${hit.rel}:${hit.line}`}
                      >
                        {hit.rel}:{hit.line}
                      </span>
                    </div>
                    <span className="w-full truncate text-[11px] text-foreground/70">
                      {parts.map((part, i) => (
                        <span
                          key={`${i}:${part.text}`}
                          className={part.hit ? "rounded bg-yellow-400/30 text-foreground" : undefined}
                        >
                          {part.text}
                        </span>
                      ))}
                    </span>
                  </button>
                );
              })
            )}
            {runningDeep ? (
              <div className="px-3 py-1.5 text-[10px] text-muted-foreground">Running deep search...</div>
            ) : null}
            {tab === "files" && partialReason === "budget_timeout" ? (
              <div className="px-3 py-1.5 text-[10px] text-muted-foreground">
                Partial results: deep search hit time budget.
              </div>
            ) : null}
            {tab === "text" && deepBlocked ? (
              <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-muted-foreground">
                Query too short for auto deep search.
                <button
                  type="button"
                  onClick={runDeepAnyway}
                  className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-foreground hover:bg-accent"
                >
                  Run Deep Anyway
                </button>
              </div>
            ) : null}
            {truncated && visibleCount > 0 && !runningDeep ? (
              <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-muted-foreground">
                <span>Showing first 100 results.</span>
                {tab === "files" &&
                (partialReason === "budget_timeout" ||
                  partialReason === "budget_scanned") ? (
                  <button
                    type="button"
                    onClick={runDeepAnyway}
                    className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-foreground hover:bg-accent"
                  >
                    Search Deeper
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </ScrollArea>
      ) : null}
    </div>
  );
});
