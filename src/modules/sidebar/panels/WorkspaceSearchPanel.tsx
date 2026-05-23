import { native } from "@/modules/ai/lib/native";
import type { GrepHit } from "@/modules/ai/lib/native";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useRef, useState } from "react";

export type WorkspaceSearchPanelProps = {
  explorerRoot: string | null;
  onOpenFile: (path: string, pin?: boolean) => void;
};

type GroupedResult = {
  rel: string;
  path: string;
  hits: GrepHit[];
};

function groupByFile(hits: GrepHit[]): GroupedResult[] {
  const map = new Map<string, GroupedResult>();
  for (const hit of hits) {
    const existing = map.get(hit.path);
    if (existing) {
      existing.hits.push(hit);
    } else {
      map.set(hit.path, { rel: hit.rel, path: hit.path, hits: [hit] });
    }
  }
  return Array.from(map.values());
}

export function WorkspaceSearchPanel({ explorerRoot, onOpenFile }: WorkspaceSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GroupedResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const genRef = useRef(0);

  const runSearch = useCallback(
    async (q: string) => {
      if (!q.trim() || !explorerRoot) {
        setResults([]);
        setTruncated(false);
        return;
      }
      const gen = ++genRef.current;
      setSearching(true);
      try {
        const res = await native.grep({
          pattern: q,
          root: explorerRoot,
          caseInsensitive: true,
          maxResults: 200,
        });
        if (gen !== genRef.current) return;
        setResults(groupByFile(res.hits));
        setTruncated(res.truncated);
      } catch {
        if (gen !== genRef.current) return;
        setResults([]);
        setTruncated(false);
      } finally {
        if (gen === genRef.current) setSearching(false);
      }
    },
    [explorerRoot],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSearch(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/60 px-2 py-1.5">
        <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1">
          <HugeiconsIcon
            icon={Search01Icon}
            size={12}
            strokeWidth={1.75}
            className="shrink-0 text-muted-foreground"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files…"
            className="min-w-0 flex-1 bg-transparent text-[11.5px] outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!query.trim() && (
          <p className="p-3 text-[11px] text-muted-foreground">Type to search across files.</p>
        )}
        {query.trim() && !searching && results.length === 0 && (
          <p className="p-3 text-[11px] text-muted-foreground">No matches found.</p>
        )}
        {results.map((group) => {
          const iconUrl = fileIconUrl(group.path);
          const parts = group.rel.split(/[\\/]/);
          const filename = parts.pop() ?? group.rel;
          const dir = parts.join("/");
          return (
            <div key={group.path} className="border-b border-border/40 last:border-0">
              <div className="flex items-center gap-1.5 px-2 py-1">
                {iconUrl ? (
                  <img src={iconUrl} alt="" className="h-3 w-3 shrink-0" />
                ) : null}
                <span className="text-[11px] font-medium text-foreground truncate">{filename}</span>
                {dir ? (
                  <span className="min-w-0 truncate text-[10px] text-muted-foreground/70">{dir}</span>
                ) : null}
              </div>
              {group.hits.map((hit, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onOpenFile(hit.path, true)}
                  className="flex w-full items-baseline gap-1.5 px-3 py-0.5 text-left hover:bg-foreground/[0.04]"
                >
                  <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground/60">
                    {hit.line}
                  </span>
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                    {hit.text.trim()}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
        {truncated && (
          <p className="p-2 text-[10px] text-muted-foreground/70 text-center">
            Results truncated — refine your query.
          </p>
        )}
      </div>
    </div>
  );
}
