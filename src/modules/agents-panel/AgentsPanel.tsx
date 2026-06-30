import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import { displayAgent } from "@/modules/agents/lib/format";
import type { AgentSession, AgentStatus } from "@/modules/agents/lib/types";
import type { Tab } from "@/modules/tabs/lib/useTabs";
import { cn } from "@/lib/utils";

type Props = {
  sessions: AgentSession[];
  tabs: Tab[];
  onSelectTab: (tabId: number) => void;
};

function StatusBadge({ status }: { status: AgentStatus }) {
  if (status === "idle") {
    return (
      <span className="inline-flex items-center rounded-full bg-muted/60 px-1.5 py-0.5 text-[9px] font-medium leading-none text-muted-foreground">
        idle
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium leading-none",
        status === "waiting"
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
      )}
    >
      {status === "waiting" ? "needs input" : "working"}
    </span>
  );
}

function tabTitleFor(tabs: Tab[], tabId: number): string | null {
  const t = tabs.find((x) => x.id === tabId);
  if (!t) return null;
  if (t.kind === "terminal") return t.customTitle ?? t.title ?? null;
  return null;
}

export function AgentsPanel({ sessions, tabs, onSelectTab }: Props) {
  if (sessions.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PanelHeader />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <span className="text-[11.5px] text-muted-foreground">
            No active agents.
          </span>
          <span className="text-[10.5px] leading-relaxed text-muted-foreground/70">
            Start{" "}
            <code className="rounded bg-muted/50 px-1 font-mono">claude</code>,{" "}
            <code className="rounded bg-muted/50 px-1 font-mono">codex</code>,{" "}
            <code className="rounded bg-muted/50 px-1 font-mono">gemini</code>,
            or{" "}
            <code className="rounded bg-muted/50 px-1 font-mono">opencode</code>{" "}
            in a terminal, or use{" "}
            <code className="rounded bg-muted/50 px-1 font-mono">
              /claude-code
            </code>{" "}
            in the AI chat.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader count={sessions.length} />
      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {sessions.map((s) => {
          const tabTitle = tabTitleFor(tabs, s.tabId);
          return (
            <li key={s.leafId}>
              <button
                type="button"
                onClick={() => onSelectTab(s.tabId)}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-foreground/[0.05] active:bg-foreground/[0.08]"
              >
                <AgentIcon agent={s.agent} size={15} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12px] font-medium">
                      {displayAgent(s.agent)}
                    </span>
                    <StatusBadge status={s.status} />
                  </div>
                  {tabTitle ? (
                    <span className="block truncate text-[10.5px] text-muted-foreground">
                      {tabTitle}
                    </span>
                  ) : null}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PanelHeader({ count }: { count?: number }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Agents
      </span>
      {count !== undefined && count > 0 ? (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[9px] font-semibold tabular-nums text-primary">
          {count}
        </span>
      ) : null}
    </div>
  );
}
