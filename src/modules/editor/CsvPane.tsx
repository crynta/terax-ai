import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { useEffect, useRef, useState } from "react";

type CsvResult = {
  headers: string[];
  rows: string[][];
  total_rows: number;
};

type Props = {
  path: string;
};

// Rainbow palette — 10 distinct hues that remain readable on dark backgrounds
const COLUMN_COLORS = [
  "hsl(0, 80%, 72%)",    // red
  "hsl(30, 90%, 68%)",   // orange
  "hsl(55, 85%, 65%)",   // yellow
  "hsl(120, 55%, 65%)",  // green
  "hsl(170, 65%, 62%)",  // teal
  "hsl(200, 80%, 70%)",  // sky
  "hsl(230, 75%, 75%)",  // blue
  "hsl(270, 70%, 75%)",  // purple
  "hsl(310, 65%, 72%)",  // pink
  "hsl(340, 75%, 72%)",  // rose
];

import { useVirtualizer } from "@tanstack/react-virtual";

export function CsvPane({ path }: Props) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CsvResult | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");

    invoke<CsvResult>("fs_read_csv", {
      path,
      workspace: currentWorkspaceEnv(),
    })
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setStatus("ready");
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setStatus("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  const rowVirtualizer = useVirtualizer({
    count: data?.rows.length ?? 0,
    getScrollElement: () => tableRef.current,
    estimateSize: () => 24, // Estimate 24px height per row
    overscan: 10,
  });

  if (status === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Loading CSV file…
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-destructive">
        {error ?? "Unknown error"}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border/60 px-3 py-1.5 bg-background">
        <span className="text-[11px] text-muted-foreground">
          {data.headers.length} columns · {data.total_rows.toLocaleString()} rows
          {data.total_rows > data.rows.length && ` (showing first ${data.rows.length.toLocaleString()})`}
        </span>
      </div>
      <div ref={tableRef} className="flex-1 overflow-auto bg-background">
        <table className="w-full border-collapse text-[12px] font-mono table-fixed">
          <thead className="sticky top-0 z-10 bg-background shadow-sm">
            <tr>
              <th className="border-b border-r border-border/40 px-2 py-1 text-right text-[10px] font-normal text-muted-foreground/50 w-12 bg-background">
                #
              </th>
              {data.headers.map((h, i) => (
                <th
                  key={i}
                  className="border-b border-r border-border/40 px-3 py-1 text-left font-semibold truncate bg-background"
                  style={{ color: COLUMN_COLORS[i % COLUMN_COLORS.length] }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = data.rows[virtualRow.index];
              return (
                <tr
                  key={virtualRow.index}
                  className="hover:bg-accent/30 transition-colors absolute w-full flex"
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                    display: "table-row"
                  }}
                >
                  <td className="border-r border-b border-border/20 px-2 py-0.5 text-right text-[10px] text-muted-foreground/40 whitespace-nowrap overflow-hidden">
                    {virtualRow.index + 1}
                  </td>
                  {data.headers.map((_, ci) => (
                    <td
                      key={ci}
                      className="border-r border-b border-border/20 px-3 py-0.5 whitespace-nowrap overflow-hidden text-ellipsis"
                      style={{ color: COLUMN_COLORS[ci % COLUMN_COLORS.length] }}
                    >
                      {row[ci] ?? ""}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
