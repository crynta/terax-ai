import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AgentIcon } from "@/modules/agents/lib/agentIcon";
import {
  AGENT_LAUNCHERS,
  type AgentInstanceCount,
  type AgentLaunchCommands,
  type AgentLauncherId,
  type AgentLaunchRequest,
  DEFAULT_AGENT_LAUNCH_COMMANDS,
  findAgentLauncher,
  validateAgentLaunchCommand,
} from "@/modules/agents/lib/launcher";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { setAgentLaunchCommands } from "@/modules/settings/store";
import {
  ArrowLeft01Icon,
  PlayIcon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

type Props = {
  onBack: () => void;
  onLaunch: (request: AgentLaunchRequest) => void;
};

const INSTANCE_COUNTS: AgentInstanceCount[] = [1, 2, 3, 4];

export function AgentLauncherPanel({ onBack, onLaunch }: Props) {
  const storedCommands = usePreferencesStore((s) => s.agentLaunchCommands);
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const [agentId, setAgentId] = useState<AgentLauncherId>("claude");
  const [instances, setInstances] = useState<AgentInstanceCount>(2);
  const [drafts, setDrafts] = useState<AgentLaunchCommands>(storedCommands);
  const hydratedRef = useRef(hydrated);
  const persistedRef = useRef(storedCommands);
  const command = drafts[agentId];
  const validation = validateAgentLaunchCommand(command);
  const launcher = findAgentLauncher(agentId);

  useEffect(() => {
    if (!hydrated || hydratedRef.current) return;
    hydratedRef.current = true;
    persistedRef.current = storedCommands;
    setDrafts(storedCommands);
  }, [hydrated, storedCommands]);

  const save = (next: AgentLaunchCommands) => {
    const changed = AGENT_LAUNCHERS.some(
      ({ id }) => next[id] !== persistedRef.current[id],
    );
    if (!changed) return;
    const previous = persistedRef.current;
    persistedRef.current = next;
    void setAgentLaunchCommands(next).catch((error) => {
      persistedRef.current = previous;
      console.error("[terax] failed to save agent launch commands:", error);
    });
  };

  const persist = (
    id: AgentLauncherId,
    value: string,
  ): AgentLaunchCommands | null => {
    const result = validateAgentLaunchCommand(value);
    if (!result.ok) return null;
    const next = { ...drafts, [id]: result.command };
    setDrafts(next);
    save(next);
    return next;
  };

  const selectAgent = (id: AgentLauncherId) => {
    persist(agentId, command);
    setAgentId(id);
  };

  const resetCommand = () => {
    const next = {
      ...drafts,
      [agentId]: DEFAULT_AGENT_LAUNCH_COMMANDS[agentId],
    };
    setDrafts(next);
    save(next);
  };

  const submit = () => {
    const next = persist(agentId, command);
    if (!next) return;
    onLaunch({
      agent: agentId,
      command: next[agentId],
      instances,
    });
  };

  return (
    <form
      className="animate-in fade-in-0 slide-in-from-right-2 duration-150"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex h-9 items-center gap-2 px-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="rounded-md text-muted-foreground"
          onClick={onBack}
          aria-label="Back to new tab menu"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={1.75} />
        </Button>
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-foreground">
            Launch agents
          </div>
          <div className="text-[10px] text-muted-foreground">
            One workspace, up to four panes
          </div>
        </div>
      </div>

      <div className="mt-1 grid grid-cols-2 gap-1 border-t border-border/60 pt-1.5">
        {AGENT_LAUNCHERS.map((agent) => {
          const selected = agent.id === agentId;
          return (
            <button
              key={agent.id}
              type="button"
              disabled={!hydrated}
              aria-pressed={selected}
              onClick={() => selectAgent(agent.id)}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:opacity-50",
                selected
                  ? "border-primary/35 bg-primary/10 text-foreground"
                  : "border-transparent bg-foreground/[0.035] text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <AgentIcon
                agent={agent.id}
                size={16}
                className={cn(
                  "shrink-0",
                  selected ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span className="truncate text-xs font-medium">
                {agent.label}
              </span>
            </button>
          );
        })}
      </div>

      <fieldset className="mt-3">
        <legend className="mb-1.5 text-[11px] font-medium text-muted-foreground">
          Instances
        </legend>
        <div className="grid grid-cols-4 gap-1">
          {INSTANCE_COUNTS.map((count) => (
            <button
              key={count}
              type="button"
              disabled={!hydrated}
              aria-label={`${count} ${count === 1 ? "instance" : "instances"}`}
              aria-pressed={instances === count}
              onClick={() => setInstances(count)}
              className={cn(
                "flex h-9 items-center justify-center gap-1.5 rounded-xl border text-xs font-medium transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:opacity-50",
                instances === count
                  ? "border-primary/35 bg-primary/10 text-foreground"
                  : "border-border/60 bg-background/30 text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <PaneGlyph count={count} />
              {count}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-3">
        <div className="mb-1.5 flex items-center">
          <label
            htmlFor="agent-start-command"
            className="text-[11px] font-medium text-muted-foreground"
          >
            Start command
          </label>
          <button
            type="button"
            onClick={resetCommand}
            disabled={
              !hydrated || command === DEFAULT_AGENT_LAUNCH_COMMANDS[agentId]
            }
            className="ml-auto flex items-center gap-1 rounded-md px-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            title={`Reset to ${launcher.defaultCommand}`}
          >
            <HugeiconsIcon icon={Refresh01Icon} size={11} strokeWidth={1.75} />
            Reset
          </button>
        </div>
        <Input
          id="agent-start-command"
          disabled={!hydrated}
          value={command}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={!validation.ok}
          onChange={(event) =>
            setDrafts((current) => ({
              ...current,
              [agentId]: event.target.value,
            }))
          }
          onBlur={() => persist(agentId, command)}
          className="h-8 rounded-xl bg-input/40 px-2.5 font-mono text-xs"
          placeholder={launcher.defaultCommand}
        />
        <div
          className={cn(
            "mt-1 min-h-4 text-[10px]",
            validation.ok ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {validation.ok
            ? "Aliases and flags are supported."
            : validation.error}
        </div>
      </div>

      <Button
        type="submit"
        size="sm"
        className="mt-1 w-full rounded-xl"
        disabled={!hydrated || !validation.ok}
      >
        <HugeiconsIcon icon={PlayIcon} size={13} strokeWidth={2} />
        Launch {instances} {instances === 1 ? "agent" : "agents"}
      </Button>
    </form>
  );
}

function PaneGlyph({ count }: { count: AgentInstanceCount }) {
  const cell = "rounded-[1px] bg-current opacity-75";
  if (count === 1) {
    return (
      <span className="grid size-3 grid-cols-1 gap-px rounded-[2px] border border-current/50 p-px">
        <span className={cell} />
      </span>
    );
  }
  if (count === 2) {
    return (
      <span className="grid size-3 grid-cols-2 gap-px rounded-[2px] border border-current/50 p-px">
        <span className={cell} />
        <span className={cell} />
      </span>
    );
  }
  if (count === 3) {
    return (
      <span className="grid size-3 grid-cols-2 grid-rows-2 gap-px rounded-[2px] border border-current/50 p-px">
        <span className={cn(cell, "row-span-2")} />
        <span className={cell} />
        <span className={cell} />
      </span>
    );
  }
  return (
    <span className="grid size-3 grid-cols-2 grid-rows-2 gap-px rounded-[2px] border border-current/50 p-px">
      <span className={cell} />
      <span className={cell} />
      <span className={cell} />
      <span className={cell} />
    </span>
  );
}
