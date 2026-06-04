import { Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import type { AgentStatus } from "@/modules/agents/lib/types";
import { PiSection } from "@/modules/pi/components/PiSection";
import {
  PI_LOCAL_AGENT_POLICY,
  piLocalAgentInstallSummary,
  type PiLocalAgentId,
  type PiLocalAgentStatus,
} from "@/modules/pi/lib/local-agents";

type PiLocalAgentActivity = {
  id?: PiLocalAgentId;
  label: string;
  status: AgentStatus;
  detail?: string | null;
};

type PiLocalAgentsCardProps = {
  activeAgents: PiLocalAgentActivity[];
  agents: PiLocalAgentStatus[];
  collapsed: boolean;
  disabled: boolean;
  isRefreshing: boolean;
  prompt: string;
  onCollapsedChange: (collapsed: boolean) => void;
  onInstall: (agent: PiLocalAgentStatus) => void;
  onLaunch: (agent: PiLocalAgentStatus) => void;
  onLaunchWithPrompt: (agent: PiLocalAgentStatus) => void;
  onRefresh: () => void;
};

function statusLabel(status: AgentStatus): string {
  if (status === "waiting") return "waiting";
  if (status === "finished") return "finished";
  if (status === "error") return "failed";
  if (status === "idle") return "idle";
  return "working";
}

function statusDotClass(status: AgentStatus): string {
  if (status === "waiting") return "bg-foreground/70";
  if (status === "error") return "bg-destructive";
  if (status === "finished") return "bg-muted-foreground/45";
  if (status === "idle") return "bg-muted-foreground/35";
  return "bg-muted-foreground/60";
}

function AgentActivityRow({ agent }: { agent: PiLocalAgentActivity }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/35 bg-background/70 px-2.5 py-2">
      <AgentIcon
        agent={agent.label}
        size={14}
        className="shrink-0 text-muted-foreground"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11.5px] font-medium text-foreground">
          {agent.label}
        </div>
        {agent.detail ? (
          <div className="truncate text-[10.5px] text-muted-foreground">
            {agent.detail}
          </div>
        ) : null}
      </div>
      <Badge
        variant="outline"
        className="h-4 gap-1 rounded-md border-border/55 px-1.5 text-[9.5px] text-muted-foreground"
      >
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full", statusDotClass(agent.status))}
        />
        {statusLabel(agent.status)}
      </Badge>
    </div>
  );
}

function AgentInstallBadge({ installed }: { installed: boolean }) {
  return (
    <Badge
      variant={installed ? "secondary" : "outline"}
      className="h-4 rounded-md px-1.5 text-[9.5px] text-muted-foreground"
    >
      {installed ? "Installed" : "Missing"}
    </Badge>
  );
}

function AgentStatusRow({
  agent,
  disabled,
  onInstall,
  onLaunch,
  onLaunchWithPrompt,
  promptAvailable,
}: {
  agent: PiLocalAgentStatus;
  disabled: boolean;
  promptAvailable: boolean;
  onInstall: (agent: PiLocalAgentStatus) => void;
  onLaunch: (agent: PiLocalAgentStatus) => void;
  onLaunchWithPrompt: (agent: PiLocalAgentStatus) => void;
}) {
  const canLaunch = agent.installed && agent.planCommand !== null;
  const unavailable = agent.launchUnavailableReason;

  return (
    <div className="rounded-lg border border-border/35 bg-card/60 px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <AgentIcon
          agent={agent.label}
          size={14}
          className="shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[11.5px] font-medium text-foreground">
              {agent.label}
            </span>
            <AgentInstallBadge installed={agent.installed} />
          </div>
          <div className="truncate font-mono text-[10px] text-muted-foreground/70">
            {agent.binary}
          </div>
        </div>
        {canLaunch ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="xs"
              variant="outline"
              className="h-5 rounded-md px-1.5 text-[10px]"
              disabled={disabled}
              onClick={() => onLaunch(agent)}
            >
              Open terminal
            </Button>
            {promptAvailable ? (
              <Button
                size="xs"
                variant="secondary"
                className="h-5 rounded-md px-1.5 text-[10px]"
                disabled={disabled}
                onClick={() => onLaunchWithPrompt(agent)}
              >
                With prompt
              </Button>
            ) : null}
          </div>
        ) : (
          <Button
            size="xs"
            variant="ghost"
            className="h-5 shrink-0 rounded-md px-1.5 text-[10px]"
            disabled={disabled}
            onClick={() => onInstall(agent)}
          >
            {agent.installed ? "Docs" : "Install"}
          </Button>
        )}
      </div>
      <p className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground">
        {unavailable ?? agent.guardrail}
      </p>
    </div>
  );
}

export function PiLocalAgentsCard({
  activeAgents,
  agents,
  collapsed,
  disabled,
  isRefreshing,
  prompt,
  onCollapsedChange,
  onInstall,
  onLaunch,
  onLaunchWithPrompt,
  onRefresh,
}: PiLocalAgentsCardProps) {
  const summary = piLocalAgentInstallSummary(agents);
  const promptAvailable = prompt.trim() !== "";

  return (
    <PiSection
      title="Local CLI agents"
      collapsed={collapsed}
      summary={
        <Badge
          variant="outline"
          className="h-4 rounded-md px-1.5 text-[9.5px] text-muted-foreground"
        >
          {summary.installed}/{summary.total}
        </Badge>
      }
      actions={
        <Button
          size="xs"
          variant="ghost"
          className="h-5 rounded-md px-1.5 text-[10px]"
          disabled={disabled || isRefreshing}
          onClick={onRefresh}
        >
          {isRefreshing ? (
            <Spinner className="size-2.5" />
          ) : (
            <HugeiconsIcon icon={Refresh01Icon} size={11} strokeWidth={1.75} />
          )}
          Refresh
        </Button>
      }
      onCollapsedChange={onCollapsedChange}
    >
      <div className="flex flex-col gap-2 px-2 pb-2">
        <div className="rounded-lg border border-border/35 bg-card/60 px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] font-medium text-foreground">
            <Badge
              variant="secondary"
              className="h-4 rounded-md px-1.5 text-[9.5px] text-muted-foreground"
            >
              {PI_LOCAL_AGENT_POLICY.posture}
            </Badge>
            <span>No hidden spawns</span>
          </div>
          <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
            Agents open in normal terminals with visible output. Settings stay
            separate; this sidebar is for detection, status, and safe launch.
          </p>
        </div>

        {activeAgents.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <div className="px-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75">
              Active
            </div>
            {activeAgents.map((agent, index) => (
              <AgentActivityRow key={`${agent.label}-${index}`} agent={agent} />
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          {agents.map((agent) => (
            <AgentStatusRow
              key={agent.id}
              agent={agent}
              disabled={disabled}
              promptAvailable={promptAvailable}
              onInstall={onInstall}
              onLaunch={onLaunch}
              onLaunchWithPrompt={onLaunchWithPrompt}
            />
          ))}
        </div>
      </div>
    </PiSection>
  );
}
