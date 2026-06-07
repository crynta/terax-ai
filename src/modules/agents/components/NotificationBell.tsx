import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import CheckmarkCircle02Icon from "@hugeicons/core-free-icons/CheckmarkCircle02Icon";
import Loading03Icon from "@hugeicons/core-free-icons/Loading03Icon";
import Notification01Icon from "@hugeicons/core-free-icons/Notification01Icon";
import Notification03Icon from "@hugeicons/core-free-icons/Notification03Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { AgentIcon } from "../lib/agentIcon";
import {
  AGENT_HOOK_TARGETS,
  type AgentHookProviderId,
  type AgentHookTarget,
} from "../lib/providers";
import {
  type AgentStatusContext,
  type AgentStatusItem,
  buildAgentStatusSurface,
} from "../lib/statusSurface";
import type { AgentSurfaceStatus } from "../lib/types";
import { useAgentStore } from "../store/agentStore";

type Props = {
  terminalContext: Record<number, AgentStatusContext>;
  onActivate: (tabId: number, leafId: number) => void;
  onActivateLocal: () => void;
  onActivatePi: (sessionId: string) => void;
};

function initialHookState(): Record<AgentHookProviderId, boolean | null> {
  return Object.fromEntries(
    AGENT_HOOK_TARGETS.map((target) => [target.id, null]),
  ) as Record<AgentHookProviderId, boolean | null>;
}

const STATUS_LABEL: Record<AgentSurfaceStatus, string> = {
  attention: "needs input",
  error: "failed",
  finished: "finished",
  idle: "idle",
  working: "working",
};

function relativeTime(ts: number): string {
  if (ts <= 0) return "now";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function statusDotClass(status: AgentSurfaceStatus): string {
  switch (status) {
    case "attention":
      return "bg-foreground/75";
    case "error":
      return "bg-destructive";
    case "working":
      return "bg-muted-foreground/70";
    case "finished":
      return "bg-muted-foreground/45";
    case "idle":
      return "bg-muted-foreground/35";
  }
}

function statusToneClass(status: AgentSurfaceStatus): string {
  switch (status) {
    case "attention":
      return "border-border/70 text-foreground";
    case "error":
      return "border-destructive/40 text-destructive";
    case "working":
      return "border-border/60 text-muted-foreground";
    case "finished":
      return "border-border/50 text-muted-foreground";
    case "idle":
      return "border-border/50 text-muted-foreground/80";
  }
}

function AgentStatusRow({
  item,
  onClick,
  onDismiss,
}: {
  item: AgentStatusItem;
  onClick: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex min-h-10 w-full items-center gap-1 rounded-md transition-colors duration-150 hover:bg-foreground/[0.04]",
        item.unread && "bg-foreground/[0.035]",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={`${item.title}, ${STATUS_LABEL[item.status]}`}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
      >
        <span className="relative flex size-5 shrink-0 items-center justify-center rounded-md bg-foreground/[0.04]">
          <AgentIcon
            agent={item.agent}
            size={16}
            className="text-muted-foreground"
          />
          {item.unread ? (
            <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-foreground/75 ring-2 ring-popover" />
          ) : null}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[12px] font-medium text-foreground">
              {item.title}
            </span>
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
              {relativeTime(item.sortAt)}
            </span>
          </span>
          {item.subtitle ? (
            <span className="block truncate text-[11px] leading-4 text-muted-foreground">
              {item.subtitle}
            </span>
          ) : null}
          {item.detail ? (
            <span className="block truncate text-[10.5px] leading-3.5 text-muted-foreground/75">
              {item.detail}
            </span>
          ) : null}
        </span>

        <Badge
          variant="outline"
          className={cn(
            "h-5 min-w-[5.25rem] shrink-0 justify-center gap-1 rounded-md border px-1.5 text-[10px] font-medium",
            statusToneClass(item.status),
          )}
        >
          <span
            aria-hidden
            className={cn("size-1.5 rounded-full", statusDotClass(item.status))}
          />
          {STATUS_LABEL[item.status]}
        </Badge>
      </button>
      {item.dismissible && onDismiss ? (
        <button
          type="button"
          title="Dismiss update"
          aria-label={`Dismiss ${item.title}`}
          onClick={onDismiss}
          className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 opacity-0 transition-opacity hover:bg-foreground/[0.06] hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/35"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}

export function NotificationBell({
  terminalContext,
  onActivate,
  onActivateLocal,
  onActivatePi,
}: Props) {
  const [open, setOpen] = useState(false);
  const [hooksReady, setHooksReady] = useState(initialHookState);
  const [installing, setInstalling] = useState<AgentHookProviderId | null>(
    null,
  );
  const sessions = useAgentStore((s) => s.sessions);
  const localAgent = useAgentStore((s) => s.localAgent);
  const piSessions = useAgentStore((s) => s.piSessions);
  const notifications = useAgentStore((s) => s.notifications);
  const markAllRead = useAgentStore((s) => s.markAllRead);
  const removeNotification = useAgentStore((s) => s.removeNotification);
  const clearNotifications = useAgentStore((s) => s.clearNotifications);

  const surface = useMemo(
    () =>
      buildAgentStatusSurface({
        localAgent,
        notifications,
        piSessions,
        sessions,
        terminalContext,
      }),
    [localAgent, notifications, piSessions, sessions, terminalContext],
  );

  const badge =
    surface.counts.attention +
    surface.counts.failed +
    surface.items.filter(
      (item) =>
        item.unread && item.status !== "attention" && item.status !== "error",
    ).length;

  const refreshHooks = () => {
    for (const target of AGENT_HOOK_TARGETS) {
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

  const enableHooks = async (target: AgentHookTarget) => {
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

  const activateItem = (item: AgentStatusItem) => {
    if (item.source === "local") {
      onActivateLocal();
      setOpen(false);
      return;
    }
    if (item.source === "pi" && item.activate.piSessionId) {
      onActivatePi(item.activate.piSessionId);
      setOpen(false);
      return;
    }
    if (
      item.source === "terminal" &&
      typeof item.activate.tabId === "number" &&
      typeof item.activate.leafId === "number"
    ) {
      onActivate(item.activate.tabId, item.activate.leafId);
      setOpen(false);
    }
  };

  const empty = surface.items.length === 0;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Agent status"
        >
          <HugeiconsIcon
            data-icon="inline-start"
            icon={Notification01Icon}
            strokeWidth={1.75}
          />
          {badge > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-md bg-foreground px-0.5 text-[9px] font-semibold leading-none text-background">
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[22rem] max-w-[calc(100vw-1rem)] gap-0.5 overflow-hidden p-0"
      >
        <div className="flex min-h-12 items-center gap-2 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium text-foreground">
              Agent status
            </div>
            <div className="truncate text-[10.5px] text-muted-foreground">
              Live agents sorted by attention
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {notifications.length > 0 ? (
              <button
                type="button"
                onClick={clearNotifications}
                className="h-5 rounded-md px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
              >
                Clear history
              </button>
            ) : null}
            {surface.counts.attention > 0 ? (
              <Badge
                variant="secondary"
                className="h-5 rounded-md px-1.5 text-[10px]"
              >
                {surface.counts.attention} needs input
              </Badge>
            ) : null}
            {surface.counts.failed > 0 ? (
              <Badge
                variant="destructive"
                className="h-5 rounded-md px-1.5 text-[10px]"
              >
                {surface.counts.failed} failed
              </Badge>
            ) : null}
            {surface.counts.working > 0 ? (
              <Badge
                variant="outline"
                className="h-5 rounded-md px-1.5 text-[10px]"
              >
                {surface.counts.working} working
              </Badge>
            ) : null}
          </div>
        </div>

        {empty ? (
          <div className="border-t border-border/60 px-4 py-5 text-center text-[11px] leading-relaxed text-muted-foreground">
            <div className="font-medium text-foreground">No active agents</div>
            <div className="mt-1">
              Start Terax, Pi, Claude Code, Codex, Cursor Agent, OpenCode,
              Gemini, or Antigravity and live state appears here.
            </div>
          </div>
        ) : (
          <div className="max-h-[min(28rem,calc(100vh-5rem))] overflow-y-auto border-t border-border/60 p-1.5">
            {surface.liveItems.map((item) => (
              <AgentStatusRow
                key={item.id}
                item={item}
                onClick={() => activateItem(item)}
              />
            ))}
            {surface.recentItems.length > 0 ? (
              <>
                {surface.liveItems.length > 0 ? (
                  <div className="my-1 border-t border-border/60" />
                ) : null}
                <div className="px-2 pt-1 pb-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                  Recent updates
                </div>
                {surface.recentItems.map((item) => (
                  <AgentStatusRow
                    key={item.id}
                    item={item}
                    onClick={() => activateItem(item)}
                    onDismiss={
                      item.notificationId
                        ? () => removeNotification(item.notificationId ?? "")
                        : undefined
                    }
                  />
                ))}
              </>
            ) : null}
          </div>
        )}

        <div className="flex flex-col gap-0.5 border-t border-border/60 p-1">
          <div className="px-2 pt-1 pb-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/75">
            Terminal hooks
          </div>
          {AGENT_HOOK_TARGETS.map((target) =>
            hooksReady[target.id] ? (
              <div
                key={target.id}
                className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-muted-foreground"
              >
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  size={13}
                  strokeWidth={1.75}
                  className="text-muted-foreground"
                />
                {target.enabledLabel}
              </div>
            ) : (
              <div key={target.id}>
                <button
                  type="button"
                  onClick={() => void enableHooks(target)}
                  disabled={installing !== null}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground disabled:opacity-60"
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
                  {installing === target.id
                    ? "Enabling..."
                    : target.enableLabel}
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
