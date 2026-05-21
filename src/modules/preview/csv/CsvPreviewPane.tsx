import Papa from "papaparse";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type SortState = { index: number; dir: "asc" | "desc" } | null;

type Parsed = {
  rows: string[][];
  errors: Papa.ParseError[];
};

type ResizeState = {
  index: number;
  startX: number;
  startWidth: number;
} | null;

const MIN_COL_WIDTH = 120;
const MAX_COL_WIDTH = 520;

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return String(value);
}

function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/,/g, "");
  if (!/^[+-]?\d*(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(normalized)) {
    return null;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function compareValues(a: string, b: string): number {
  const aNum = parseNumber(a);
  const bNum = parseNumber(b);
  if (aNum !== null && bNum !== null) return aNum - bNum;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function clampWidth(width: number): number {
  return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, Math.round(width)));
}

function estimateColumnWidth(
  label: string,
  colIdx: number,
  rows: string[][],
): number {
  let maxLen = label.length;
  const limit = Math.min(rows.length, 21);
  for (let i = 1; i < limit; i += 1) {
    const cell = normalizeCell(rows[i]?.[colIdx]);
    if (cell.length > maxLen) maxLen = cell.length;
  }
  return clampWidth(maxLen * 8 + 32);
}

export function CsvPreviewPane({ content }: { content: string }) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [hiddenColumns, setHiddenColumns] = useState<Set<number>>(
    () => new Set(),
  );
  const [colWidths, setColWidths] = useState<number[]>([]);
  const resizeRef = useRef<ResizeState>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const parsed = useMemo<Parsed>(() => {
    const result = Papa.parse<string[]>(content, {
      skipEmptyLines: true,
      dynamicTyping: false,
    });
    const rows = (result.data ?? []).filter((row) => Array.isArray(row)) as string[][];
    return { rows, errors: result.errors ?? [] };
  }, [content]);

  const rawHeaders = parsed.rows[0] ?? [];
  const rawDataRowsCount = Math.max(0, parsed.rows.length - 1);

  const columnCount = useMemo(() => {
    const rows = parsed.rows;
    let maxData = 0;
    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i].length > maxData) {
        maxData = rows[i].length;
      }
    }
    return Math.max(rawHeaders.length, maxData);
  }, [parsed.rows, rawHeaders.length]);

  const columns = useMemo(
    () =>
      Array.from({ length: columnCount }, (_, i) => {
        const header = rawHeaders[i];
        return header && header.trim() ? header : `Column ${i + 1}`;
      }),
    [columnCount, rawHeaders],
  );

  useEffect(() => {
    setHiddenColumns((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((idx) => idx < columnCount));
      return next.size === prev.size ? prev : next;
    });
  }, [columnCount]);

  useEffect(() => {
    if (columnCount === 0) return;
    setColWidths((prev) => {
      const next = [...prev];
      let changed = false;
      const rows = parsed.rows;
      for (let i = 0; i < columnCount; i += 1) {
        if (next[i] === undefined) {
          next[i] = estimateColumnWidth(columns[i], i, rows);
          changed = true;
        }
      }
      if (next.length > columnCount) {
        next.length = columnCount;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [columnCount, columns, parsed.rows]);

  const visibleColumnIndices = useMemo(() => {
    const indices: number[] = [];
    for (let i = 0; i < columnCount; i += 1) {
      if (!hiddenColumns.has(i)) indices.push(i);
    }
    return indices;
  }, [columnCount, hiddenColumns]);

  const visibleColumnCount = visibleColumnIndices.length;

  const filteredIndices = useMemo<number[]>(() => {
    const query = filter.trim().toLowerCase();
    const rows = parsed.rows;
    const count = Math.max(0, rows.length - 1);
    const indices: number[] = [];
    if (!query) {
      for (let i = 0; i < count; i += 1) {
        indices.push(i);
      }
      return indices;
    }
    for (let i = 0; i < count; i += 1) {
      const row = rows[i + 1];
      if (row.some((cell) => normalizeCell(cell).toLowerCase().includes(query))) {
        indices.push(i);
      }
    }
    return indices;
  }, [parsed.rows, filter]);

  const sortedIndices = useMemo<number[]>(() => {
    if (!sort) return filteredIndices;
    const { index, dir } = sort;
    const rows = parsed.rows;
    const next = [...filteredIndices];
    next.sort((a, b) => {
      const aVal = normalizeCell(rows[a + 1]?.[index]);
      const bVal = normalizeCell(rows[b + 1]?.[index]);
      const cmp = compareValues(aVal, bVal);
      if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
      return a - b;
    });
    return next;
  }, [parsed.rows, filteredIndices, sort]);

  const virtualizer = useVirtualizer({
    count: sortedIndices.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 32,
    overscan: 20,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - virtualRows[virtualRows.length - 1].end
      : 0;

  const toggleSort = (index: number) => {
    setSort((prev) => {
      if (!prev || prev.index !== index) return { index, dir: "asc" };
      if (prev.dir === "asc") return { index, dir: "desc" };
      return null;
    });
  };

  const handleMouseMove = useCallback((event: MouseEvent) => {
    const state = resizeRef.current;
    if (!state) return;
    const nextWidth = clampWidth(
      state.startWidth + (event.clientX - state.startX),
    );
    setColWidths((prev) => {
      const next = [...prev];
      next[state.index] = nextWidth;
      return next;
    });
  }, []);

  const stopResize = useCallback(() => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", stopResize);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, [handleMouseMove]);

  const startResize = useCallback(
    (index: number, e: ReactMouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const th = (e.currentTarget as HTMLElement).closest("th");
      const startWidth = clampWidth(
        th?.getBoundingClientRect().width ?? colWidths[index] ?? MIN_COL_WIDTH,
      );
      resizeRef.current = {
        index,
        startX: e.clientX,
        startWidth,
      };
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", stopResize);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [colWidths, handleMouseMove, stopResize],
  );

  useEffect(() => () => stopResize(), [stopResize]);

  const setColumnVisible = useCallback(
    (index: number, visible: boolean) => {
      if (!visible && visibleColumnCount <= 1) return;
      if (!visible) {
        setSort((prev) => (prev?.index === index ? null : prev));
      }
      setHiddenColumns((prev) => {
        const next = new Set(prev);
        if (visible) {
          next.delete(index);
          return next;
        }
        next.add(index);
        return next;
      });
    },
    [visibleColumnCount],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-card/40 px-3 py-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          CSV preview
        </div>
        <div className="min-w-[180px] flex-1">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter rows"
            className="h-8"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={columnCount === 0}
            >
              Columns
              <span className="ml-1 text-[10px] text-muted-foreground">
                {visibleColumnCount}/{columnCount}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="flex flex-col py-1">
              {columns.map((name, index) => {
                const checked = !hiddenColumns.has(index);
                const disabled = visibleColumnCount === 1 && checked;
                return (
                  <DropdownMenuItem
                    key={`${name}-${index}`}
                    disabled={disabled}
                    onSelect={(e) => {
                      e.preventDefault();
                      setColumnVisible(index, !checked);
                    }}
                    title={name}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      readOnly
                      disabled={disabled}
                      className="mr-3 h-4 w-4 rounded border border-border bg-background pointer-events-none"
                    />
                    <span className="truncate">{name}</span>
                  </DropdownMenuItem>
                );
              })}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="text-[11px] text-muted-foreground">
          {filteredIndices.length} / {rawDataRowsCount} rows
        </div>
      </div>
      {parsed.errors.length ? (
        <div className="border-b border-border/60 bg-destructive/10 px-3 py-1 text-[11px] text-destructive">
          {parsed.errors.length} parse error{parsed.errors.length === 1 ? "" : "s"}
        </div>
      ) : null}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]"
      >
        {columnCount === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            No data to preview.
          </div>
        ) : (
          <table className="min-w-max table-fixed border-separate border-spacing-0 text-[12px]">
            <colgroup>
              {visibleColumnIndices.map((colIdx) => (
                <col
                  key={`col-${colIdx}`}
                  style={{
                    width: colWidths[colIdx]
                      ? `${colWidths[colIdx]}px`
                      : undefined,
                  }}
                />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr>
                {visibleColumnIndices.map((colIdx, visibleIdx) => {
                  const name = columns[colIdx];
                  const isSorted = sort?.index === colIdx;
                  const sortDir = isSorted ? sort?.dir : null;
                  return (
                    <th
                      key={`${name}-${colIdx}`}
                      className={cn(
                        "group relative border-b border-border/60 px-3 py-2 text-left text-[11px] font-medium text-foreground/80",
                        visibleIdx % 2 === 0 ? "bg-muted/30" : "bg-muted/15",
                      )}
                      aria-sort={
                        sortDir === "asc"
                          ? "ascending"
                          : sortDir === "desc"
                            ? "descending"
                            : "none"
                      }
                      style={{
                        width: colWidths[colIdx]
                          ? `${colWidths[colIdx]}px`
                          : undefined,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(colIdx)}
                        className="flex w-full items-center justify-between gap-2"
                      >
                        <span className="truncate" title={name}>
                          {name}
                        </span>
                        <span className="flex flex-col text-[9px] leading-[9px] text-muted-foreground">
                          <span
                            className={cn(
                              sortDir === "asc"
                                ? "text-foreground"
                                : "opacity-40",
                            )}
                          >
                            ▲
                          </span>
                          <span
                            className={cn(
                              sortDir === "desc"
                                ? "text-foreground"
                                : "opacity-40",
                            )}
                          >
                            ▼
                          </span>
                        </span>
                      </button>
                      <div
                        role="separator"
                        aria-orientation="vertical"
                        onMouseDown={(e) => startResize(colIdx, e)}
                        className="absolute right-0 top-0 h-full w-2 cursor-col-resize"
                      >
                        <span className="absolute right-0 top-0 h-full w-px bg-border/70 opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedIndices.length === 0 ? (
                <tr>
                  <td
                    colSpan={Math.max(visibleColumnCount, 1)}
                    className="px-3 py-6 text-center text-xs text-muted-foreground"
                  >
                    No rows match the current filter.
                  </td>
                </tr>
              ) : (
                <>
                  {paddingTop > 0 && (
                    <tr>
                      <td
                        style={{ height: `${paddingTop}px`, padding: 0, border: 0 }}
                        colSpan={visibleColumnCount}
                      />
                    </tr>
                  )}
                  {virtualRows.map((virtualRow) => {
                    const originalIdx = sortedIndices[virtualRow.index];
                    const row = parsed.rows[originalIdx + 1];
                    if (!row) return null;
                    return (
                      <tr
                        key={virtualRow.key}
                        data-index={virtualRow.index}
                        ref={virtualizer.measureElement}
                        className="border-b border-border/50"
                      >
                        {visibleColumnIndices.map((colIdx, visibleIdx) => (
                          <td
                            key={`${originalIdx}-${colIdx}`}
                            className={cn(
                              "truncate border-b border-border/40 px-3 py-1.5 align-top",
                              visibleIdx % 2 === 0 ? "bg-muted/10" : "bg-muted/5",
                            )}
                            style={{
                              width: colWidths[colIdx]
                                ? `${colWidths[colIdx]}px`
                                : undefined,
                            }}
                            title={normalizeCell(row[colIdx])}
                          >
                            {normalizeCell(row[colIdx])}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {paddingBottom > 0 && (
                    <tr>
                      <td
                        style={{ height: `${paddingBottom}px`, padding: 0, border: 0 }}
                        colSpan={visibleColumnCount}
                      />
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
