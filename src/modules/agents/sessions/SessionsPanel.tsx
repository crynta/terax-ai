import { useGitBranch } from "@/app/components/useGitBranch";
import { cn } from "@/lib/utils";
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import { displayAgent } from "@/modules/agents/lib/format";
import {
  basename,
  type SessionRow,
  selectSessionRows,
} from "@/modules/agents/lib/sessionRows";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { useAgentActivityStore } from "@/modules/terminal/lib/agentActivity";
import { ptyIdForLeaf } from "@/modules/terminal/lib/terminalSessionApi";
import {
  AiChat02Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  BookOpen01Icon,
  CheckmarkCircle02Icon,
  GitBranchIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useEffect, useMemo, useState } from "react";
import { resumeChat } from "../reader/lib/conversation";
import {
  loadSessionTitles,
  useSessionTitles,
} from "../reader/lib/sessionTitles";
import { HistoryPanel } from "../reader/ReaderHistory";

export type SessionsPanelProps = {
  tabs: readonly Tab[];
  onActivate: (tabId: number, leafId: number) => void;
  onOpenReader: (tabId: number, leafId: number) => void;
  onLaunchClaude: () => void;
  /** Folder whose past Claude chats are listed under "Past chats". */
  historyCwd?: string | null;
  /** Shows a past chat in the active pane's Reader; false when there's no terminal pane. */
  onOpenPastChat?: (sessionId: string) => boolean;
};

const SECTIONS: {
  id: string;
  title: string;
  match: (row: SessionRow) => boolean;
}[] = [
  {
    id: "attention",
    title: "Needs you",
    match: (r) => r.phase === "attention",
  },
  { id: "working", title: "Working", match: (r) => r.phase === "working" },
  {
    id: "done",
    title: "Done",
    match: (r) => r.phase === "finished" || r.phase === "idle",
  },
];

export function SessionsPanel({
  tabs,
  onActivate,
  onOpenReader,
  onLaunchClaude,
  historyCwd = null,
  onOpenPastChat,
}: SessionsPanelProps) {
  const [historyOpen, setHistoryOpen] = useState(true);
  const customTitles = useSessionTitles((s) => s.titles);
  useEffect(() => {
    void loadSessionTitles();
  }, []);
  const sessions = useAgentStore((s) => s.sessions);
  const notifications = useAgentStore((s) => s.notifications);
  const phases = useAgentActivityStore((s) => s.phases);
  const sessionIds = useAgentActivityStore((s) => s.sessionIds);
  const rows = useMemo(
    () =>
      selectSessionRows({
        sessions,
        phases,
        sessionIds,
        notifications,
        tabs,
        ptyIdForLeaf,
      }),
    [sessions, phases, sessionIds, notifications, tabs],
  );
  const now = useNow(30_000);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Agent sessions
        </span>
        {rows.length > 0 && (
          <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
            {rows.length}
          </span>
        )}
        <button
          type="button"
          onClick={onLaunchClaude}
          className="ml-auto rounded-md px-1.5 py-0.5 text-[11px] font-medium text-primary outline-none transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          + Claude
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {rows.length === 0 ? (
          <EmptyState onLaunchClaude={onLaunchClaude} />
        ) : (
          SECTIONS.map((section) => {
            const sectionRows = rows.filter(section.match);
            if (sectionRows.length === 0) return null;
            return (
              <section key={section.id} className="mb-3">
                <h3 className="px-1.5 pb-1.5 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/90">
                  {section.title}
                  <span className="ml-1.5 font-normal tabular-nums">
                    {sectionRows.length}
                  </span>
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {sectionRows.map((row) => (
                    <SessionCard
                      key={row.leafId}
                      row={
                        row.claudeSessionId && customTitles[row.claudeSessionId]
                          ? {
                              ...row,
                              title: customTitles[row.claudeSessionId],
                            }
                          : row
                      }
                      now={now}
                      onActivate={onActivate}
                      onOpenReader={onOpenReader}
                    />
                  ))}
                </ul>
              </section>
            );
          })
        )}
        {historyCwd && (
          <section className="mt-2 border-t border-border/50 pt-2">
            <button
              type="button"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 rounded-md px-1.5 pb-1.5 pt-1 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/90 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <HugeiconsIcon
                icon={historyOpen ? ArrowDown01Icon : ArrowRight01Icon}
                size={11}
                strokeWidth={2.2}
              />
              Past chats
              <span className="ml-auto truncate font-normal normal-case tracking-normal">
                {basename(historyCwd)}
              </span>
            </button>
            {historyOpen && (
              <div className="flex max-h-[60vh] min-h-0 flex-col">
                <HistoryPanel
                  cwd={historyCwd}
                  liveSessionId={null}
                  dense
                  onOpen={(id) => {
                    if (!onOpenPastChat?.(id)) resumeChat(historyCwd, id);
                  }}
                  onResume={(id) => resumeChat(historyCwd, id)}
                />
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setNow(Date.now());
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

const SessionCard = memo(function SessionCard({
  row,
  now,
  onActivate,
  onOpenReader,
}: {
  row: SessionRow;
  now: number;
  onActivate: (tabId: number, leafId: number) => void;
  onOpenReader: (tabId: number, leafId: number) => void;
}) {
  const branch = useGitBranch(
    row.cwd,
    row.phase === "finished" ? row.lastActivityAt : 0,
  );
  const folder = row.cwd ? basename(row.cwd) : null;
  const timing =
    row.phase === "working"
      ? `running ${ago(now - row.lastActivityAt)}`
      : row.phase === "attention"
        ? `waiting ${ago(now - (row.attentionSince ?? row.lastActivityAt))}`
        : `${ago(now - row.lastActivityAt)} ago`;
  return (
    <li>
      <div
        className={cn(
          "group relative flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors",
          row.phase === "attention"
            ? "border-[color-mix(in_oklab,var(--agent-attention)_45%,transparent)] bg-[color-mix(in_oklab,var(--agent-attention)_8%,transparent)]"
            : "border-border/50 bg-card/60 hover:border-border hover:bg-card",
        )}
      >
        <button
          type="button"
          onClick={() => onActivate(row.tabId, row.leafId)}
          className="absolute inset-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={`Go to ${row.title}`}
        />
        <span className="pointer-events-none relative grid size-7 shrink-0 place-items-center rounded-md bg-muted/60 text-foreground">
          <AgentIcon agent={row.agent} size={15} />
          <StatusDot phase={row.phase} />
        </span>
        <div className="pointer-events-none min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[12.5px] font-medium text-foreground">
              {row.title}
            </span>
            {row.paneLabel && (
              <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                {row.paneLabel}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            {branch ? (
              <span className="flex min-w-0 items-center gap-1">
                <HugeiconsIcon
                  icon={GitBranchIcon}
                  size={11}
                  strokeWidth={1.9}
                  className="shrink-0"
                />
                <span className="truncate">{branch}</span>
              </span>
            ) : folder ? (
              <span className="truncate">{folder}</span>
            ) : (
              <span>{displayAgent(row.agent)}</span>
            )}
            <span aria-hidden>·</span>
            <span className="shrink-0 tabular-nums">{timing}</span>
          </div>
          <PhaseLine row={row} />
        </div>
        <button
          type="button"
          onClick={() => onOpenReader(row.tabId, row.leafId)}
          aria-label="Open in Reader"
          title="Open in Reader"
          className="relative z-[1] grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-foreground/[0.06] hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/40 group-hover:opacity-100"
        >
          <HugeiconsIcon icon={BookOpen01Icon} size={14} strokeWidth={1.8} />
        </button>
      </div>
    </li>
  );
});

function StatusDot({ phase }: { phase: SessionRow["phase"] }) {
  return (
    <span
      className={cn(
        "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-sidebar",
        phase === "working" && "animate-pulse bg-agent-working",
        phase === "attention" && "bg-agent-attention",
        phase === "finished" && "bg-agent-done",
        phase === "idle" && "bg-muted-foreground/60",
      )}
    />
  );
}

function PhaseLine({ row }: { row: SessionRow }) {
  if (row.phase === "working") {
    return (
      <div className="mt-1 flex items-center gap-1 text-[11px] text-agent-working">
        <HugeiconsIcon
          icon={Loading03Icon}
          size={11}
          className="animate-spin"
        />
        Working…
      </div>
    );
  }
  if (row.phase === "attention") {
    return (
      <div className="mt-1 text-[11px] font-medium text-agent-attention">
        Needs your input
      </div>
    );
  }
  if (row.phase === "finished") {
    return (
      <div className="mt-1 flex items-center gap-1 text-[11px] text-agent-done">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} size={11} strokeWidth={2} />
        Finished turn
      </div>
    );
  }
  return null;
}

function EmptyState({ onLaunchClaude }: { onLaunchClaude: () => void }) {
  return (
    <div className="mx-1 mt-6 flex flex-col items-center rounded-xl border border-dashed border-border/70 px-4 py-6 text-center">
      <span className="grid size-9 place-items-center rounded-xl bg-primary/12 text-primary">
        <HugeiconsIcon icon={AiChat02Icon} size={18} strokeWidth={1.8} />
      </span>
      <div className="mt-3 text-[12.5px] font-medium text-foreground">
        No agent sessions yet
      </div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
        Start Claude Code in any terminal, or launch one here. Sessions show
        their status as they work.
      </p>
      <button
        type="button"
        onClick={onLaunchClaude}
        className="mt-3 flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <AgentIcon agent="claude" size={13} />
        Launch Claude Code
      </button>
    </div>
  );
}
