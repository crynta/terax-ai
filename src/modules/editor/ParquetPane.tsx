import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { useEffect, useRef, useState } from "react";

type ParquetColumn = {
  name: string;
  dtype: string;
};

type ParquetResult = {
  columns: ParquetColumn[];
  rows: any[][];
  total_rows: number;
};

type Props = {
  path: string;
};

import { useVirtualizer } from "@tanstack/react-virtual";

export function ParquetPane({ path }: Props) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ParquetResult | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");

    invoke<ParquetResult>("fs_read_parquet", {
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
        Loading Parquet file…
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

  const virtualItems = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0]?.start || 0 : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? rowVirtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1]?.end || 0)
      : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border/60 px-3 py-1.5 bg-background">
        <span className="text-[11px] text-muted-foreground">
          {data.columns.length} columns · {data.total_rows.toLocaleString()} rows
          {data.total_rows > data.rows.length &&
            ` (showing first ${data.rows.length.toLocaleString()})`}
        </span>
      </div>
      <div ref={tableRef} className="flex-1 overflow-auto bg-background">
        <table className="w-full border-collapse text-[12px] font-mono">
          <thead className="sticky top-0 z-10 bg-background shadow-sm">
            <tr>
              <th className="border-b border-r border-border/40 px-2 py-1 text-right text-[10px] font-normal text-muted-foreground/50 w-12 bg-background">
                #
              </th>
              {data.columns.map((col, i) => (
                <th
                  key={i}
                  className="border-b border-r border-border/40 px-3 py-1 text-left whitespace-nowrap bg-background"
                >
                  <div className="font-semibold text-foreground/90">{col.name}</div>
                  <div className="text-[10px] font-normal text-muted-foreground/60">{col.dtype}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr>
                <td style={{ height: `${paddingTop}px` }} colSpan={data.columns.length + 1} />
              </tr>
            )}
            {virtualItems.map((virtualRow) => {
              const row = data.rows[virtualRow.index];
              return (
                <tr
                  key={virtualRow.index}
                  className="hover:bg-accent/30 transition-colors"
                  style={{ height: `${virtualRow.size}px` }}
                >
                  <td className="border-r border-b border-border/20 px-2 py-0.5 text-right text-[10px] text-muted-foreground/40 bg-muted/5 whitespace-nowrap">
                    {virtualRow.index + 1}
                  </td>
                  {data.columns.map((_, ci) => {
                    const val = row[ci];
                    const display =
                      val === null ? "null" : typeof val === "object" ? JSON.stringify(val) : String(val);
                    return (
                      <td
                        key={ci}
                        className={`border-r border-b border-border/20 px-3 py-0.5 whitespace-nowrap ${
                          val === null ? "text-muted-foreground/40 italic" : "text-foreground/80"
                        }`}
                      >
                        {display}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr>
                <td style={{ height: `${paddingBottom}px` }} colSpan={data.columns.length + 1} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
