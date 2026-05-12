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
  Cancel01Icon,
  Folder01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { motion } from "motion/react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
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
};

const MIN_QUERY_LEN = 2;
const DEBOUNCE_MS = 300;

type Props = {
  rootPath: string;
  onOpenFile: (path: string) => void;
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

export const ExplorerSearch = forwardRef<ExplorerSearchHandle, Props>(function ExplorerSearch({
  rootPath,
  onOpenFile,
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
  const [results, setResults] = useState<SearchHit[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const active = query.trim().length > 0;

  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
      setSearching(false);
      setTruncated(false);
    }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LEN) {
      setResults([]);
      setSelectedIndex(0);
      setSearching(false);
      setTruncated(false);
      return;
    }
    setSearching(true);
    let alive = true;
    const handle = setTimeout(async () => {
      try {
        const res = await invoke<SearchResult>("fs_search", {
          root: rootPath,
          query: q,
          limit: 200,
          showHidden,
          workspace: currentWorkspaceEnv(),
        });
        if (alive) {
          setResults(res.hits);
          setTruncated(res.truncated);
          setSelectedIndex(0);
        }
      } catch (e) {
        if (alive) {
          console.error("fs_search failed:", e);
          setResults([]);
          setTruncated(false);
          setSelectedIndex(0);
        }
      } finally {
        if (alive) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [query, rootPath, showHidden]);

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
    if (active && results.length > 0) {
      const el = scrollRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, results, active]);

  const handleSelect = (hit: SearchHit) => {
    if (!hit.is_dir) {
      onOpenFile(hit.path);
    }
  };

  return (
    <div className="flex flex-col">
      {open ? (
        <motion.div
          className="relative shrink-0 px-2 py-1.5"
          initial={{ opacity: 0, transform: "translateY(-15px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
        >
          <HugeiconsIcon
            icon={Search01Icon}
            size={13}
            strokeWidth={2}
            className="absolute top-1/2 left-4 -translate-y-1/2 text-muted-foreground"
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
              if (results.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSelectedIndex((prev) => (prev + 1) % results.length);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  handleSelect(results[selectedIndex]);
                }
              }
            }}
            placeholder="Search files…"
            className="h-7 pr-7 pl-6.5 text-xs"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute top-1/2 right-3.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Clear search"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
            </button>
          ) : null}
        </motion.div>
      ) : null}

      {active ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="py-1" ref={scrollRef}>
            {searching && results.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-muted-foreground">
                Searching…
              </div>
            ) : results.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-muted-foreground">
                No matches
              </div>
            ) : (
              results.map((hit, index) => {
                const url = hit.is_dir ? null : fileIconUrl(hit.name);
                const isSelected = index === selectedIndex;
                return (
                  <ContextMenu key={hit.path}>
                    <ContextMenuTrigger asChild>
                      <button
                        type="button"
                        data-index={index}
                        onClick={() => handleSelect(hit)}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={cn(
                          "flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs transition-colors",
                          isSelected ? "bg-accent text-foreground" : "hover:bg-accent/50 text-foreground/80"
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
                        <span className="ml-auto truncate text-[10px] text-muted-foreground">
                          {hit.rel}
                        </span>
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent className={COMPACT_CONTENT}>
                      {!hit.is_dir && (
                        <ContextMenuItem
                          className={COMPACT_ITEM}
                          onSelect={() => onOpenFile(hit.path)}
                        >
                          Open
                        </ContextMenuItem>
                      )}
                      {hit.is_dir && onRevealInTerminal && (
                        <ContextMenuItem
                          className={COMPACT_ITEM}
                          onSelect={() => onRevealInTerminal(hit.path)}
                        >
                          Open in Terminal
                        </ContextMenuItem>
                      )}
                      <ContextMenuItem
                        className={COMPACT_ITEM}
                        onSelect={() => void revealInFinder(hit.path)}
                      >
                        Reveal in Finder
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        className={COMPACT_ITEM}
                        onSelect={() => void copyToClipboard(hit.path)}
                      >
                        Copy Path
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        className={COMPACT_ITEM}
                        onSelect={() => onAttachToAgent?.(hit.path)}
                      >
                        Attach to Agent
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })
            )}
            {truncated && results.length > 0 ? (
              <div className="px-3 py-1.5 text-[10px] text-muted-foreground">
                Showing partial results — refine your query.
              </div>
            ) : null}
          </div>
        </ScrollArea>
      ) : null}
    </div>
  );
});
