import { AiChat02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { sessionStatusDotClass } from "@/modules/pi/components/classes";
import type { PiSession } from "@/modules/pi/lib/sessions";
import { pathBasename } from "@/modules/pi/lib/view";

type PiSessionListProps = {
  canCreateSession: boolean;
  disabled: boolean;
  runtimeReady: boolean;
  selectedSessionId: string | null;
  sessions: PiSession[];
  workspaceRoot: string | null;
  onCreateSession: () => void;
  onSelectSession: (sessionId: string) => void;
};

function emptyDescription(
  runtimeReady: boolean,
  workspaceRoot: string | null,
): string {
  if (!runtimeReady) return "Start Pi to create a workspace-bound session.";
  if (!workspaceRoot) return "Open a workspace before creating a Pi session.";
  return "Create a session to ask Pi about the current workspace.";
}

export function PiSessionList({
  canCreateSession,
  disabled,
  runtimeReady,
  selectedSessionId,
  sessions,
  workspaceRoot,
  onCreateSession,
  onSelectSession,
}: PiSessionListProps) {
  const selectedIndex = Math.max(
    0,
    sessions.findIndex((session) => session.id === selectedSessionId),
  );

  const selectSessionAt = (index: number, target: HTMLElement) => {
    const nextSession = sessions[index];
    if (!nextSession) return;
    onSelectSession(nextSession.id);
    requestAnimationFrame(() => {
      const options = target
        .closest('[role="listbox"]')
        ?.querySelectorAll<HTMLElement>("[data-pi-session-option]");
      options?.[index]?.focus();
    });
  };

  const onSessionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const lastIndex = sessions.length - 1;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        selectSessionAt(Math.min(index + 1, lastIndex), event.currentTarget);
        break;
      case "ArrowUp":
        event.preventDefault();
        selectSessionAt(Math.max(index - 1, 0), event.currentTarget);
        break;
      case "Home":
        event.preventDefault();
        selectSessionAt(0, event.currentTarget);
        break;
      case "End":
        event.preventDefault();
        selectSessionAt(lastIndex, event.currentTarget);
        break;
    }
  };

  return (
    <div className="flex min-h-0 shrink-0 flex-col border-b border-border/35">
      <div className="flex h-7 shrink-0 items-center gap-2 px-3">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/85">
          Sessions
        </span>
        <Badge
          variant="outline"
          className="h-4 min-w-4 px-1 text-[9.5px] text-muted-foreground"
        >
          {sessions.length}
        </Badge>
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto h-5 rounded-md px-1.5 text-[10px]"
          disabled={!canCreateSession || disabled}
          onClick={onCreateSession}
        >
          New
        </Button>
      </div>

      {sessions.length === 0 ? (
        <Empty className="min-h-36 gap-2 rounded-none border-0 px-4 py-5">
          <EmptyHeader className="gap-1.5">
            <EmptyMedia
              variant="icon"
              className="size-9 rounded-xl text-muted-foreground"
            >
              <HugeiconsIcon icon={AiChat02Icon} size={16} strokeWidth={1.75} />
            </EmptyMedia>
            <EmptyTitle className="text-[12px] tracking-normal">
              No Pi sessions
            </EmptyTitle>
            <EmptyDescription className="max-w-52 text-[10.5px] leading-snug">
              {emptyDescription(runtimeReady, workspaceRoot)}
            </EmptyDescription>
          </EmptyHeader>
          {canCreateSession ? (
            <EmptyContent className="gap-0">
              <Button
                size="xs"
                className="h-6"
                disabled={disabled}
                onClick={onCreateSession}
              >
                Create session
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <div
          role="listbox"
          aria-label="Pi sessions"
          className="flex max-h-44 min-h-0 flex-col gap-1 overflow-y-auto px-2 pb-2"
        >
          {sessions.map((session, index) => {
            const selected = selectedSessionId === session.id;
            const cwdLabel = pathBasename(session.cwd) ?? "No workspace";
            return (
              <button
                key={session.id}
                type="button"
                role="option"
                aria-selected={selected}
                data-pi-session-option
                tabIndex={selected || index === selectedIndex ? 0 : -1}
                className={cn(
                  "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-left outline-none transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-primary/30",
                  selected
                    ? "border-border/70 bg-foreground/[0.07] text-foreground"
                    : "border-border/35 bg-background/70 text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
                )}
                onClick={() => onSelectSession(session.id)}
                onKeyDown={(event) => onSessionKeyDown(event, index)}
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    sessionStatusDotClass(session.status),
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] font-medium text-foreground">
                    {session.title}
                  </span>
                  <span className="block truncate text-[10px] capitalize text-muted-foreground">
                    {session.status} · {cwdLabel}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
