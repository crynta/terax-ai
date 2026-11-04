import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { AgentPhase } from "@/modules/terminal/lib/agentActivity";
import {
  AiBrain01Icon,
  Alert02Icon,
  ArrowDown02Icon,
  ArrowUp02Icon,
  CheckListIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  FlashIcon,
  Folder01Icon,
  GitCompareIcon,
  PencilEdit02Icon,
  RoboticIcon,
  Shield01Icon,
  UserMultipleIcon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type ReactNode, useEffect, useState } from "react";
import {
  type FooterAgent,
  MODE_LABELS,
  type PermissionMode,
} from "./lib/claudeFooter";
import { useQueuedPrompts } from "./lib/queueStore";
import { displayPath } from "./lib/readerView";
import { useClaudeActivity, useClaudeFooter } from "./lib/screenStore";
import {
  formatCount,
  type SessionFacts,
  sessionFacts,
} from "./lib/sessionFacts";
import type { SessionInfo } from "./lib/sessionInfo";
import { ContextMeter, useSessionDuration } from "./ReaderChrome";

type IconData = typeof Folder01Icon;

const MODE_STYLE: Record<
  PermissionMode,
  { icon: IconData; short: string; className: string }
> = {
  plan: {
    icon: CheckListIcon,
    short: "Plan",
    className:
      "border-[color-mix(in_oklab,var(--terminal-ansi-magenta)_45%,transparent)] bg-[color-mix(in_oklab,var(--terminal-ansi-magenta)_14%,transparent)] text-[var(--terminal-ansi-magenta)]",
  },
  acceptEdits: {
    icon: PencilEdit02Icon,
    short: "Accept edits",
    className:
      "border-[color-mix(in_oklab,var(--agent-done)_45%,transparent)] bg-[color-mix(in_oklab,var(--agent-done)_14%,transparent)] text-agent-done",
  },
  auto: {
    icon: FlashIcon,
    short: "Auto",
    className:
      "border-[color-mix(in_oklab,var(--agent-attention)_45%,transparent)] bg-[color-mix(in_oklab,var(--agent-attention)_14%,transparent)] text-agent-attention",
  },
  bypass: {
    icon: Alert02Icon,
    short: "Bypass",
    className:
      "border-[color-mix(in_oklab,var(--terminal-ansi-red)_45%,transparent)] bg-[color-mix(in_oklab,var(--terminal-ansi-red)_14%,transparent)] text-[var(--terminal-ansi-red)]",
  },
  default: {
    icon: Shield01Icon,
    short: "Ask first",
    className: "border-border/70 bg-muted/40 text-muted-foreground",
  },
};

const MODE_HINT = "Shift+Tab in the terminal cycles modes";

/** The session's facts for the Reader: footer values first, transcript-derived as fallback. */
export function useSessionFacts(
  leafId: number,
  info: SessionInfo,
  live: boolean,
  cwd: string | null,
  home: string | null,
): { facts: SessionFacts; folderPath: string | null } {
  const footer = useClaudeFooter(leafId);
  const duration = useSessionDuration(info, live);
  const folderPath = cwd ? displayPath(cwd, null, home) : null;
  const folder = cwd ? (cwd.split("/").filter(Boolean).pop() ?? cwd) : null;
  return { facts: sessionFacts(footer, info, duration, folder), folderPath };
}

export function ModePill({
  mode,
  full = false,
}: {
  mode: PermissionMode;
  full?: boolean;
}) {
  const style = MODE_STYLE[mode];
  return (
    <span
      title={`${MODE_LABELS[mode]} · ${MODE_HINT}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        style.className,
      )}
    >
      <HugeiconsIcon icon={style.icon} size={11} strokeWidth={2} />
      {full ? MODE_LABELS[mode] : style.short}
    </span>
  );
}

function Fact({
  icon,
  title,
  children,
}: {
  icon?: IconData;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap"
    >
      {icon && (
        <HugeiconsIcon
          icon={icon}
          size={12}
          className="shrink-0 text-muted-foreground/80"
        />
      )}
      {children}
    </span>
  );
}

function Changes({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="tabular-nums">
      <span className="text-agent-done">+{formatCount(added)}</span>{" "}
      <span className="text-[var(--terminal-ansi-red)]">
        −{formatCount(removed)}
      </span>
    </span>
  );
}

function agentMeta(agent: FooterAgent): string | null {
  const parts = [
    agent.elapsed,
    agent.tokens ? `${agent.tokens} tokens` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function AgentChip({ agent }: { agent: FooterAgent }) {
  const meta = agentMeta(agent);
  return (
    <span
      title={[agent.title ?? agent.name, meta].filter(Boolean).join(" · ")}
      className={cn(
        "inline-flex max-w-[16rem] min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]",
        agent.active
          ? "border-primary/50 bg-[color-mix(in_oklab,var(--primary)_12%,transparent)] text-foreground"
          : "border-border/70 bg-background/40 text-foreground/85",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          agent.active ? "bg-primary" : "bg-muted-foreground/60",
        )}
      />
      <span className="shrink-0 font-medium">{agent.name}</span>
      {agent.title && (
        <span className="min-w-0 truncate text-muted-foreground">
          {agent.title}
        </span>
      )}
      {meta && (
        <span className="shrink-0 tabular-nums text-muted-foreground/80">
          {meta}
        </span>
      )}
    </span>
  );
}

/**
 * One clean row of session facts above the composer: mode, model, folder,
 * context, cost, changes, duration, then the agents. Wraps on narrow panes.
 */
export function SessionStrip({
  facts,
  folderPath,
  composerControls = false,
}: {
  facts: SessionFacts;
  folderPath: string | null;
  /** The composer toolbar already shows model, mode and context: leave them out. */
  composerControls?: boolean;
}) {
  const items: { key: string; node: ReactNode }[] = [];
  const mode = composerControls ? null : facts.mode;
  if (facts.model && !composerControls) {
    items.push({
      key: "model",
      node: (
        <Fact icon={AiBrain01Icon} title="Model">
          <span className="font-medium text-foreground/90">{facts.model}</span>
        </Fact>
      ),
    });
  }
  if (facts.folder) {
    items.push({
      key: "folder",
      node: (
        <Fact icon={Folder01Icon} title={folderPath ?? facts.folder}>
          <span className="max-w-[10rem] truncate">{facts.folder}</span>
        </Fact>
      ),
    });
  }
  if (facts.contextPercent !== null && !composerControls) {
    items.push({
      key: "context",
      node: (
        <Fact title="Context used">
          <ContextMeter percent={facts.contextPercent} />
          <span className="tabular-nums">{facts.contextPercent}%</span>
        </Fact>
      ),
    });
  }
  if (facts.cost) {
    items.push({
      key: "cost",
      node: (
        <Fact icon={Wallet01Icon} title="Session cost">
          <span className="tabular-nums">{facts.cost}</span>
        </Fact>
      ),
    });
  }
  if (facts.added !== null && facts.removed !== null) {
    items.push({
      key: "changes",
      node: (
        <Fact icon={GitCompareIcon} title="Lines added and removed">
          <Changes added={facts.added} removed={facts.removed} />
        </Fact>
      ),
    });
  }
  if (facts.duration) {
    items.push({
      key: "duration",
      node: (
        <Fact icon={Clock01Icon} title="Session duration">
          <span className="tabular-nums">{facts.duration}</span>
        </Fact>
      ),
    });
  }
  for (const [i, extra] of facts.extras.entries()) {
    items.push({
      key: `extra-${i}`,
      node: <span className="max-w-[10rem] truncate">{extra}</span>,
    });
  }
  if (!mode && items.length === 0 && facts.agents.length === 0) {
    return null;
  }
  return (
    <div className="shrink-0 px-4">
      <section
        aria-label="Session"
        className="terax-reader-composer mx-auto flex w-full max-w-[800px] flex-wrap items-center gap-x-3 gap-y-1.5 px-1 pt-1.5 text-[11.5px] text-muted-foreground"
      >
        {mode && <ModePill mode={mode} />}
        {items.map((item, index) => (
          <span key={item.key} className="flex min-w-0 items-center gap-3">
            {(index > 0 || mode) && (
              <span aria-hidden className="h-3 w-px shrink-0 bg-border/80" />
            )}
            {item.node}
          </span>
        ))}
        {facts.agents.length > 0 && (
          <span className="ml-auto flex min-w-0 flex-wrap items-center gap-1.5">
            {facts.agents.map((agent) => (
              <AgentChip
                key={`${agent.name}-${agent.title ?? ""}`}
                agent={agent}
              />
            ))}
          </span>
        )}
      </section>
    </div>
  );
}

/** The full view's "Session" card: the same facts as labelled rows. */
export function SessionFactsCard({
  facts,
  folderPath,
}: {
  facts: SessionFacts;
  folderPath: string | null;
}) {
  const rows: { label: string; node: ReactNode }[] = [];
  if (facts.model) {
    rows.push({
      label: "Model",
      node: (
        <Fact icon={AiBrain01Icon}>
          <span className="font-medium text-foreground">{facts.model}</span>
        </Fact>
      ),
    });
  }
  if (facts.mode) {
    rows.push({ label: "Mode", node: <ModePill mode={facts.mode} full /> });
  }
  if (facts.folder) {
    rows.push({
      label: "Folder",
      node: (
        <Fact icon={Folder01Icon} title={folderPath ?? facts.folder}>
          <span className="truncate text-foreground">{facts.folder}</span>
        </Fact>
      ),
    });
  }
  if (facts.contextPercent !== null) {
    rows.push({
      label: "Context",
      node: (
        <span className="flex w-full items-center gap-2" title="Context used">
          <span className="min-w-0 flex-1">
            <ContextMeter percent={facts.contextPercent} wide />
          </span>
          <span className="tabular-nums text-foreground">
            {facts.contextPercent}%
          </span>
        </span>
      ),
    });
  }
  if (facts.cost) {
    rows.push({
      label: "Cost",
      node: (
        <Fact icon={Wallet01Icon}>
          <span className="tabular-nums text-foreground">{facts.cost}</span>
        </Fact>
      ),
    });
  }
  if (facts.added !== null && facts.removed !== null) {
    rows.push({
      label: "Changes",
      node: (
        <Fact icon={GitCompareIcon}>
          <Changes added={facts.added} removed={facts.removed} />
        </Fact>
      ),
    });
  }
  if (facts.duration) {
    rows.push({
      label: "Duration",
      node: (
        <Fact icon={Clock01Icon}>
          <span className="tabular-nums text-foreground">{facts.duration}</span>
        </Fact>
      ),
    });
  }
  for (const [i, extra] of facts.extras.entries()) {
    rows.push({
      label: i === 0 ? "Other" : "",
      node: <span className="truncate text-foreground">{extra}</span>,
    });
  }
  if (rows.length === 0 && facts.agents.length === 0) return null;
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3.5">
      <dl className="flex flex-col gap-2 text-[12px]">
        {rows.map((row, index) => (
          <div
            key={row.label || `row-${index}`}
            className="flex items-center gap-2"
          >
            <dt className="w-[4.5rem] shrink-0 text-muted-foreground">
              {row.label}
            </dt>
            <dd className="flex min-w-0 flex-1 items-center">{row.node}</dd>
          </div>
        ))}
        {facts.agents.length > 0 && (
          <div className="flex gap-2">
            <dt className="w-[4.5rem] shrink-0 pt-0.5 text-muted-foreground">
              Agents
            </dt>
            <dd className="flex min-w-0 flex-1 flex-col gap-1.5">
              {facts.agents.map((agent) => (
                <AgentRow
                  key={`${agent.name}-${agent.title ?? ""}`}
                  agent={agent}
                />
              ))}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function AgentRow({ agent }: { agent: FooterAgent }) {
  const meta = agentMeta(agent);
  return (
    <div
      className="flex min-w-0 items-start gap-1.5"
      title={agent.title ?? agent.name}
    >
      <HugeiconsIcon
        icon={RoboticIcon}
        size={12}
        className={cn(
          "mt-0.5 shrink-0",
          agent.active ? "text-primary" : "text-muted-foreground/80",
        )}
      />
      <div className="min-w-0">
        <div className="truncate text-foreground">
          <span className="font-medium">{agent.name}</span>
          {agent.title && (
            <span className="text-muted-foreground"> · {agent.title}</span>
          )}
        </div>
        {meta && (
          <div className="text-[11px] tabular-nums text-muted-foreground">
            {meta}
          </div>
        )}
      </div>
    </div>
  );
}

/** How long a finished line ("Finished in 14m 37s") stays before it fades out. */
const DONE_LINGER_MS = 6_000;

/**
 * Claude's live activity, read off its spinner line: a pulsing dot, the verb,
 * elapsed time and tokens. A finished turn shows "Finished in …" quietly, then
 * fades. Stop lives in the composer only.
 */
export function ActivityRow({
  leafId,
  inline = false,
}: {
  leafId: number;
  /** At the end of the document rather than above the composer. */
  inline?: boolean;
}) {
  const activity = useClaudeActivity(leafId);
  const doneKey = activity?.done
    ? `${activity.verb}|${activity.elapsed}|${activity.doneAt}`
    : null;
  const [faded, setFaded] = useState<string | null>(null);
  useEffect(() => {
    if (!doneKey) return;
    const timer = setTimeout(() => setFaded(doneKey), DONE_LINGER_MS);
    return () => clearTimeout(timer);
  }, [doneKey]);
  if (!activity || (doneKey !== null && faded === doneKey)) return null;

  const waiting = activity.waitingFor !== null;
  const row = (
    <div
      role="status"
      className={cn(
        "flex min-w-0 items-center gap-2 text-[12px]",
        !inline &&
          "terax-reader-composer mx-auto w-full max-w-[800px] px-1 pb-1",
        activity.done && "terax-reader-activity-fade",
      )}
    >
      {activity.done ? (
        <HugeiconsIcon
          icon={CheckmarkCircle02Icon}
          size={13}
          strokeWidth={2}
          className="shrink-0 text-agent-done"
        />
      ) : waiting ? (
        <HugeiconsIcon
          icon={UserMultipleIcon}
          size={13}
          className="shrink-0 text-agent-working"
        />
      ) : (
        <span
          aria-hidden
          className="terax-reader-activity-dot size-2 shrink-0 rounded-full bg-agent-working"
        />
      )}
      <span
        className={cn(
          "min-w-0 truncate",
          activity.done
            ? "text-muted-foreground"
            : waiting
              ? "font-medium text-foreground/90"
              : "terax-reader-shimmer font-medium",
        )}
        title={
          waiting
            ? "Background agents are listed in the session strip"
            : undefined
        }
      >
        {activity.detail ?? activity.verb}
      </span>
      {!activity.done && activity.elapsed && (
        <span
          aria-hidden
          className="shrink-0 tabular-nums text-muted-foreground"
        >
          {activity.elapsed}
        </span>
      )}
      {activity.tokens && (
        <span
          className="flex shrink-0 items-center gap-0.5 tabular-nums text-muted-foreground"
          title={
            activity.direction === "up" ? "Tokens sent" : "Tokens received"
          }
        >
          <HugeiconsIcon
            icon={activity.direction === "up" ? ArrowUp02Icon : ArrowDown02Icon}
            size={11}
          />
          {activity.tokens} tokens
        </span>
      )}
      {activity.done && activity.doneAt && (
        <span className="shrink-0 text-muted-foreground/80">
          · {activity.doneAt}
        </span>
      )}
    </div>
  );
  return inline ? row : <div className="shrink-0 px-4">{row}</div>;
}

/** A labelled row in a session card. */
function CardRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <dt className="w-[4.75rem] shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center">{children}</dd>
    </div>
  );
}

function CardTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </h3>
  );
}

const CARD = "rounded-[14px] border border-border/60 bg-card px-3.5 py-3";

/** What Claude is doing now, for the Session card's Status row. */
function StatusValue({
  leafId,
  phase,
  working,
}: {
  leafId: number;
  phase: AgentPhase | undefined;
  working: boolean;
}) {
  const activity = useClaudeActivity(leafId);
  if (working) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden
          className="terax-reader-activity-dot size-2 shrink-0 rounded-full bg-agent-working"
        />
        <span className="terax-reader-shimmer min-w-0 truncate font-medium">
          {activity?.detail ?? activity?.verb ?? "Working…"}
        </span>
        {activity?.elapsed && (
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {activity.elapsed}
          </span>
        )}
      </span>
    );
  }
  if (phase === "attention") {
    return (
      <span className="flex items-center gap-1.5 font-medium text-agent-attention">
        <span className="size-2 rounded-full bg-agent-attention" />
        Needs you
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-foreground/85">
      <span className="size-2 shrink-0 rounded-full bg-muted-foreground/50" />
      <span className="truncate">
        {activity?.done ? (activity.detail ?? "Idle") : "Idle"}
      </span>
    </span>
  );
}

/**
 * The session's facts as cards: Session (status, account, model, mode,
 * context, cost, changes, duration), Agents, and Queued when anything waits.
 * One component for the pane rail, the header pill's popover and full view.
 */
export function SessionCards({
  leafId,
  phase,
  working,
  facts,
  folderPath,
  showFolder = false,
}: {
  leafId: number;
  phase: AgentPhase | undefined;
  working: boolean;
  facts: SessionFacts;
  folderPath: string | null;
  /** The pane header already names the folder; full view's panel may not. */
  showFolder?: boolean;
}) {
  const queued = useQueuedPrompts(leafId);
  return (
    <div className="flex flex-col gap-3 text-[12.5px]">
      <section aria-label="Session" className={CARD}>
        <CardTitle>Session</CardTitle>
        <dl className="flex flex-col gap-2">
          <CardRow label="Status">
            <StatusValue leafId={leafId} phase={phase} working={working} />
          </CardRow>
          {facts.account && (
            <CardRow label="Account">
              <span className="truncate text-muted-foreground">
                {facts.account}
              </span>
            </CardRow>
          )}
          {facts.model && (
            <CardRow label="Model">
              <Fact icon={AiBrain01Icon}>
                <span className="font-medium text-foreground">
                  {facts.model}
                </span>
              </Fact>
            </CardRow>
          )}
          {facts.mode && (
            <CardRow label="Mode">
              <ModePill mode={facts.mode} full />
            </CardRow>
          )}
          {showFolder && facts.folder && (
            <CardRow label="Folder">
              <Fact icon={Folder01Icon} title={folderPath ?? facts.folder}>
                <span className="truncate text-foreground">{facts.folder}</span>
              </Fact>
            </CardRow>
          )}
          {facts.contextPercent !== null && (
            <CardRow label="Context">
              <span
                className="flex w-full items-center gap-2"
                title="Context used"
              >
                <span className="min-w-0 flex-1">
                  <ContextMeter percent={facts.contextPercent} wide />
                </span>
                <span className="tabular-nums text-foreground">
                  {facts.contextPercent}%
                </span>
              </span>
            </CardRow>
          )}
          {facts.cost && (
            <CardRow label="Cost">
              <Fact icon={Wallet01Icon}>
                <span className="tabular-nums text-foreground">
                  {facts.cost}
                </span>
              </Fact>
            </CardRow>
          )}
          {facts.added !== null && facts.removed !== null && (
            <CardRow label="Changes">
              <Fact icon={GitCompareIcon}>
                <Changes added={facts.added} removed={facts.removed} />
              </Fact>
            </CardRow>
          )}
          {facts.duration && (
            <CardRow label="Duration">
              <Fact icon={Clock01Icon}>
                <span className="tabular-nums text-foreground">
                  {facts.duration}
                </span>
              </Fact>
            </CardRow>
          )}
          {facts.extras.map((extra) => (
            <CardRow key={extra} label="">
              <span className="truncate text-muted-foreground">{extra}</span>
            </CardRow>
          ))}
        </dl>
      </section>
      {facts.agents.length > 0 && (
        <section aria-label="Agents" className={CARD}>
          <CardTitle>Agents</CardTitle>
          <ul className="flex flex-col gap-2.5">
            {facts.agents.map((agent) => {
              const meta = agentMeta(agent);
              return (
                <li
                  key={`${agent.name}-${agent.title ?? ""}`}
                  className="flex min-w-0 items-start gap-2"
                  title={agent.title ?? agent.name}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-[5px] size-2 shrink-0 rounded-full",
                      agent.active ? "bg-primary" : "bg-muted-foreground/40",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground">
                      {agent.name}
                    </div>
                    {agent.title && (
                      <div className="line-clamp-2 text-[12px] text-foreground/80">
                        {agent.title}
                      </div>
                    )}
                    {meta && (
                      <div className="text-[11px] tabular-nums text-muted-foreground">
                        {meta}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {queued.length > 0 && (
        <section aria-label="Queued" className={CARD}>
          <CardTitle>Queued · {queued.length}</CardTitle>
          <ol className="flex flex-col gap-1.5">
            {queued.map((item, index) => (
              <li key={item.id} className="flex min-w-0 gap-2">
                <span className="w-4 shrink-0 text-right tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span className="line-clamp-2 min-w-0 text-foreground/85">
                  {item.text || `${item.images.length} image(s)`}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

/** The pane's session rail beside the document column; scrolls on its own. */
export function SessionRail(props: Parameters<typeof SessionCards>[0]) {
  return (
    <aside
      aria-label="Session details"
      className="terax-reader-in min-h-0 w-[264px] shrink-0 overflow-y-auto py-5 pr-4"
    >
      <SessionCards {...props} />
    </aside>
  );
}

/**
 * The header's "Session" pill for narrow panes: a status dot and the cost,
 * opening the same cards in a popover.
 */
export function SessionPill(props: Parameters<typeof SessionCards>[0]) {
  const { facts, working, phase } = props;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Session details"
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[11.5px] text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full",
              working
                ? "terax-reader-activity-dot bg-agent-working"
                : phase === "attention"
                  ? "bg-agent-attention"
                  : "bg-muted-foreground/50",
            )}
          />
          Session
          {facts.cost && (
            <span className="tabular-nums text-foreground/85">
              {facts.cost}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="z-[1000] w-[300px] border-border/70 bg-popover p-2"
      >
        <SessionCards {...props} />
      </PopoverContent>
    </Popover>
  );
}
