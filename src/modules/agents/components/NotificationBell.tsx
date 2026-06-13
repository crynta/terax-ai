import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  CheckmarkCircle02Icon,
  Loading03Icon,
  Notification01Icon,
  Notification03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState } from "react";
import { AgentIcon } from "../lib/agentIcon";
import type { AgentNotification, AgentStatus } from "../lib/types";
import { useAgentStore } from "../store/agentStore";

type Props = {
  onActivate: (tabId: number, leafId: number) => void;
  onActivateLocal: () => void;
};

type HookTargetId = "claude" | "codex";

type HookTarget = {
  id: HookTargetId;
  statusCommand: string;
  enableCommand: string;
  enableLabel: string;
  enabledLabel: string;
  errorLabel: string;
};

const HOOK_TARGETS: HookTarget[] = [
  {
    id: "claude",
    statusCommand: "agent_claude_hooks_status",
    enableCommand: "agent_enable_claude_hooks",
    enableLabel: "Enable Claude Code alerts",
    enabledLabel: "Claude Code alerts enabled",
    errorLabel: "Could not update Claude Code config.",
  },
  {
    id: "codex",
    statusCommand: "agent_codex_hooks_status",
    enableCommand: "agent_enable_codex_hooks",
    enableLabel: "Enable Codex alerts",
    enabledLabel: "Codex alerts enabled",
    errorLabel: "Could not update Codex config.",
  },
];

function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatusRow({
  agent,
  status,
  onClick,
}: {
  agent: string;
  status: AgentStatus;
  onClick: () => void;
}) {
  const waiting = status === "waiting";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent"
    >
      <AgentIcon
        agent={agent}
        size={16}
        className="shrink-0 text-muted-foreground"
      />
      <span className="flex-1 truncate text-sm text-foreground">{agent}</span>
      <span
        className={cn(
          "flex items-center gap-1.5 text-xs",
          waiting ? "font-medium text-primary" : "text-muted-foreground",
        )}
      >
        {waiting ? <span className="size-1.5 rounded-full bg-primary" /> : null}
        {waiting ? "waiting" : "working"}
      </span>
    </button>
  );
}

const NOTIF_LABEL: Record<AgentNotification["kind"], string> = {
  attention: "needs input",
  finished: "finished",
  error: "failed",
};

function NotificationRow({
  n,
  onClick,
}: {
  n: AgentNotification;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent"
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        {n.kind === "finished" ? (
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            size={15}
            strokeWidth={1.75}
            className="text-muted-foreground"
          />
        ) : (
          <span
            className={cn(
              "size-1.5 rounded-full",
              n.kind === "error" ? "bg-destructive" : "bg-primary",
            )}
          />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {n.agent}{" "}
        <span className="text-muted-foreground">{NOTIF_LABEL[n.kind]}</span>
      </span>
      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {relativeTime(n.at)}
      </span>
    </button>
  );
}

export function NotificationBell({ onActivate, onActivateLocal }: Props) {
  const [open, setOpen] = useState(false);
  const [hooksReady, setHooksReady] = useState<
    Record<HookTargetId, boolean | null>
  >({
    claude: null,
    codex: null,
  });
  const [installing, setInstalling] = useState<HookTargetId | null>(null);
  const sessions = useAgentStore((s) => s.sessions);
  const localAgent = useAgentStore((s) => s.localAgent);
  const notifications = useAgentStore((s) => s.notifications);
  const markAllRead = useAgentStore((s) => s.markAllRead);

  const active = useMemo(() => Object.values(sessions), [sessions]);
  const activeCount = active.length + (localAgent ? 1 : 0);
  const waitingCount =
    active.filter((s) => s.status === "waiting").length +
    (localAgent?.status === "waiting" ? 1 : 0);
  // attention maps to an active waiting session, so only completed events add
  // to the badge to avoid double-counting.
  const unreadDone = notifications.filter(
    (n) => !n.read && n.kind !== "attention",
  ).length;
  const badge = waitingCount + unreadDone;

  const refreshHooks = () => {
    for (const target of HOOK_TARGETS) {
      invoke<boolean>(target.statusCommand)
        .then((ready) =>
          setHooksReady((state) => ({ ...state, [target.id]: ready })),
        )
        .catch(() =>
          setHooksReady((state) => ({ ...state, [target.id]: null })),
        );
    }
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      markAllRead();
      refreshHooks();
    }
  };

  const enableHooks = async (target: HookTarget) => {
    setInstalling(target.id);
    try {
      await invoke(target.enableCommand);
      setHooksReady((state) => ({ ...state, [target.id]: true }));
    } catch {
      setHooksReady((state) => ({ ...state, [target.id]: false }));
    } finally {
      setInstalling(null);
    }
  };

  const activate = (tabId: number, leafId: number) => {
    onActivate(tabId, leafId);
    setOpen(false);
  };

  const activateLocal = () => {
    onActivateLocal();
    setOpen(false);
  };

  const activateNotification = (n: AgentNotification) => {
    if (n.source === "local") activateLocal();
    else activate(n.tabId, n.leafId);
  };

  const empty = activeCount === 0 && notifications.length === 0;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Agent notifications"
        >
          <HugeiconsIcon
            icon={Notification01Icon}
            size={16}
            strokeWidth={1.75}
          />
          {badge > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-semibold leading-none text-primary-foreground">
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 overflow-hidden p-0 gap-0.5"
      >
        <div className="flex h-10 items-center px-3 pt-0.5">
          <span className="flex gap-1 text-[13px] text-foreground">
            Notifications
          </span>
          {activeCount > 0 ? (
            <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
              {activeCount} active
            </span>
          ) : null}
        </div>

        {empty ? (
          <div className="border-t border-border/60 px-3 py-5 text-center text-xs leading-relaxed text-muted-foreground">
            No agent activity yet.
            <br />
            Run the Terax agent, Claude Code, or Codex to track it here.
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto border-t border-border/60 p-1">
            {localAgent ? (
              <StatusRow
                agent={localAgent.agent}
                status={localAgent.status}
                onClick={activateLocal}
              />
            ) : null}
            {active.map((s) => (
              <StatusRow
                key={s.leafId}
                agent={s.agent}
                status={s.status}
                onClick={() => activate(s.tabId, s.leafId)}
              />
            ))}
            {activeCount > 0 && notifications.length > 0 ? (
              <div className="mx-2 my-1 h-px bg-border/50" />
            ) : null}
            {notifications.map((n) => (
              <NotificationRow
                key={n.id}
                n={n}
                onClick={() => activateNotification(n)}
              />
            ))}
          </div>
        )}

        <div className="border-t flex flex-col gap-0.5 border-border/60 p-1">
          {HOOK_TARGETS.map((target) =>
            hooksReady[target.id] ? (
              <div
                key={target.id}
                className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-muted-foreground"
              >
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  size={13}
                  strokeWidth={1.75}
                  className="text-primary"
                />
                {target.enabledLabel}
              </div>
            ) : (
              <div key={target.id}>
                <button
                  type="button"
                  onClick={() => void enableHooks(target)}
                  disabled={installing !== null}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
                >
                  <HugeiconsIcon
                    icon={
                      installing === target.id
                        ? Loading03Icon
                        : Notification03Icon
                    }
                    size={14}
                    strokeWidth={1.75}
                    className={cn(installing === target.id && "animate-spin")}
                  />
                  {installing === target.id ? "Enabling..." : target.enableLabel}
                </button>
                {hooksReady[target.id] === false && installing !== target.id ? (
                  <p className="px-2 pt-1 text-[11px] text-destructive">
                    {target.errorLabel}
                  </p>
                ) : null}
              </div>
            ),
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
