import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { GrepHit, GrepResponse } from "./lib/types";
import { groupHitsByFile } from "./lib/searchHits";

type Props = {
  response: GrepResponse | null;
  pattern: string;
  onSelectHit: (path: string, line: number) => void;
};

export function SearchResultsList({ response, pattern, onSelectHit }: Props) {
  const activeRef = useRef<HTMLDivElement>(null);

  // Auto-scroll active result into view on keyboard navigation
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [response?.hits.length]);

  if (!pattern.trim()) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Type to search across files in the workspace
      </div>
    );
  }

  if (!response) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Searching...
      </div>
    );
  }

  if (response.hits.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        No results found for &quot;{pattern}&quot;
      </div>
    );
  }

  const groups = groupHitsByFile(response.hits);
  const totalHits = response.hits.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.path}>
            {/* File header */}
            <div className="sticky top-0 flex items-center gap-2 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
              <span className="truncate">{group.path}</span>
              <span className="shrink-0 tabular-nums opacity-60">
                {group.hits.length}
              </span>
            </div>

            {/* Hits for this file */}
            {group.hits.map((hit, idx) => (
              <HitRow
                key={`${hit.path}-${hit.line}-${idx}`}
                hit={hit}
                onSelect={onSelectHit}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Footer summary */}
      <div className="flex shrink-0 items-center justify-between border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="tabular-nums">
          {totalHits} {totalHits === 1 ? "hit" : "hits"}
          {response.truncated ? " (truncated)" : ""}
        </span>
        <span className="tabular-nums opacity-60">
          {response.files_scanned} files scanned
        </span>
      </div>
    </div>
  );
}

type HitRowProps = {
  hit: GrepHit;
  onSelect: (path: string, line: number) => void;
};

function HitRow({ hit, onSelect }: HitRowProps) {
  const handleClick = useCallback(() => {
    onSelect(hit.path, hit.line);
  }, [hit.path, hit.line, onSelect]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onSelect(hit.path, hit.line);
      }
    },
    [hit.path, hit.line, onSelect],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex cursor-pointer items-start gap-2 px-3 py-1 text-xs outline-none",
        "hover:bg-foreground/[0.04]",
        "focus-visible:bg-foreground/[0.06] focus-visible:ring-0",
        "transition-colors duration-100",
      )}
    >
      <span className="shrink-0 tabular-nums text-muted-foreground/60">
        {hit.line}
      </span>
      <span className="min-w-0 truncate text-foreground/85">
        {hit.text}
      </span>
    </div>
  );
}
