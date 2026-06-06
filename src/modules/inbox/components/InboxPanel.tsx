import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { InboxRow, InboxScope } from "@/modules/inbox/lib/model";

export type InboxFilter = "all" | "unread" | InboxScope;

type InboxPanelProps = {
  rows: readonly InboxRow[];
  onClearRead: () => void;
  onMarkRead: (rowIds: readonly string[]) => void;
  onOpenRow: (row: InboxRow) => void;
};

const FILTERS: { id: InboxFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "chat", label: "Chat" },
  { id: "artifacts", label: "Artifacts" },
  { id: "runs", label: "Runs" },
];

const SCOPE_LABELS: Record<InboxScope, string> = {
  artifacts: "Artifacts",
  chat: "Chat",
  runs: "Runs",
};

function rowMatchesFilter(row: InboxRow, filter: InboxFilter): boolean {
  if (filter === "all") return true;
  if (filter === "unread") return !row.read;
  return row.scope === filter;
}

export function deriveInboxPanelState(
  rows: readonly InboxRow[],
  filter: InboxFilter,
): {
  hasRead: boolean;
  unreadCount: number;
  visibleRows: InboxRow[];
} {
  const visibleRows: InboxRow[] = [];
  let unreadCount = 0;
  let hasRead = false;

  for (const row of rows) {
    if (row.read) hasRead = true;
    else unreadCount += 1;
    if (rowMatchesFilter(row, filter)) visibleRows.push(row);
  }

  return { hasRead, unreadCount, visibleRows };
}

export function InboxPanel({
  rows,
  onClearRead,
  onMarkRead,
  onOpenRow,
}: InboxPanelProps) {
  const [filter, setFilter] = useState<InboxFilter>("all");
  const { hasRead, unreadCount, visibleRows } = useMemo(
    () => deriveInboxPanelState(rows, filter),
    [filter, rows],
  );

  return (
    <aside
      aria-label="Inbox"
      className="flex h-full min-w-0 flex-col bg-card/80 backdrop-blur [contain:layout_style]"
    >
      <header className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold">Inbox</h2>
            {unreadCount > 0 ? (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                {unreadCount} unread
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-[11px] text-muted-foreground">
            Chat, artifacts, and Pi runs
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!hasRead}
          onClick={onClearRead}
        >
          Clear read
        </Button>
      </header>

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/50 px-2 py-2">
        {FILTERS.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="sm"
            variant={filter === item.id ? "secondary" : "ghost"}
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
            className="h-7 shrink-0 px-2 text-[11px]"
          >
            {item.label}
          </Button>
        ))}
      </div>

      {visibleRows.length === 0 ? (
        <Empty className="m-3 min-h-0 flex-1 border border-border/50 bg-background/40 p-6">
          <EmptyHeader>
            <EmptyTitle>No inbox items</EmptyTitle>
            <EmptyDescription>
              New Pi runs and artifact updates will appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-2 p-2">
            {visibleRows.map((row) => (
              <article
                key={row.id}
                className={cn(
                  "rounded-lg border bg-background/70 p-2.5 shadow-sm transition-colors [contain-intrinsic-size:128px] [content-visibility:auto]",
                  row.read
                    ? "border-border/50 opacity-75"
                    : "border-primary/25",
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <Badge
                    variant={row.read ? "outline" : "secondary"}
                    className="h-5 rounded-md px-1.5 text-[10px]"
                  >
                    {SCOPE_LABELS[row.scope]}
                  </Badge>
                  {!row.read ? (
                    <span className="size-2 rounded-full bg-primary" />
                  ) : null}
                </div>
                <h3 className="line-clamp-2 text-sm font-medium leading-snug">
                  {row.title}
                </h3>
                {row.sessionTitle ? (
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {row.sessionTitle}
                  </p>
                ) : null}
                {row.body ? (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {row.body}
                  </p>
                ) : null}
                <div className="mt-2 flex items-center justify-end gap-1">
                  {!row.read ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onMarkRead([row.id])}
                      className="h-7 px-2 text-[11px]"
                    >
                      Mark read
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={!row.action}
                    onClick={() => onOpenRow(row)}
                    className="h-7 px-2 text-[11px]"
                  >
                    Open
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </ScrollArea>
      )}
    </aside>
  );
}
