import AiChat02Icon from "@hugeicons/core-free-icons/AiChat02Icon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import Edit02Icon from "@hugeicons/core-free-icons/Edit02Icon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
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
import { PiSection } from "@/modules/pi/components/PiSection";
import type { PiSession } from "@/modules/pi/lib/sessions";
import { pathBasename } from "@/modules/pi/lib/view";

type PiSessionListProps = {
  canCreateSession: boolean;
  collapsed: boolean;
  disabled: boolean;
  runtimeReady: boolean;
  selectedSessionId: string | null;
  sessions: PiSession[];
  workspaceRoot: string | null;
  onCollapsedChange: (collapsed: boolean) => void;
  onCreateSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onResumeSession: (sessionId: string) => void;
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

function sessionTime(session: PiSession): number {
  const parsed = Date.parse(session.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortedSessionsByRecency(sessions: PiSession[]): PiSession[] {
  return sessions
    .map((session, index) => ({ index, session }))
    .sort((left, right) => {
      const order = sessionTime(right.session) - sessionTime(left.session);
      return order === 0 ? left.index - right.index : order;
    })
    .map(({ session }) => session);
}

function formatUpdatedAt(session: PiSession): string {
  const timestamp = sessionTime(session);
  if (timestamp === 0) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(new Date(timestamp));
}

function promptPreview(session: PiSession): string | null {
  const prompt = session.lastPrompt?.replace(/\s+/g, " ").trim();
  if (!prompt) return null;
  return prompt.length > 72 ? `${prompt.slice(0, 71).trimEnd()}…` : prompt;
}

export function filterPiSessions(
  sessions: PiSession[],
  query: string,
): PiSession[] {
  const normalizedQuery = query.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalizedQuery) return sessions;

  return sessions.filter((session) => {
    const haystack = [
      session.title,
      session.status,
      session.cwd ?? "",
      pathBasename(session.cwd) ?? "",
      session.lastPrompt ?? "",
    ]
      .join(" ")
      .replace(/\s+/g, " ")
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

function sessionOptionLabel(session: PiSession): string {
  const preview = promptPreview(session);
  return [session.title, session.status, preview].filter(Boolean).join(", ");
}

export function nextPiSessionDeleteConfirmationId(
  currentSessionId: string | null,
  clickedSessionId: string,
): { nextSessionId: string | null; shouldDelete: boolean } {
  return currentSessionId === clickedSessionId
    ? { nextSessionId: null, shouldDelete: true }
    : { nextSessionId: clickedSessionId, shouldDelete: false };
}

export function reconcilePiSessionDeleteConfirmationId(
  currentSessionId: string | null,
  selectedSessionId: string | null,
): string | null {
  return currentSessionId !== null && currentSessionId === selectedSessionId
    ? currentSessionId
    : null;
}

export function PiSessionList({
  canCreateSession,
  collapsed,
  disabled,
  runtimeReady,
  selectedSessionId,
  sessions,
  workspaceRoot,
  onCollapsedChange,
  onCreateSession,
  onDeleteSession,
  onRenameSession,
  onResumeSession,
  onSelectSession,
}: PiSessionListProps) {
  const [search, setSearch] = useState("");
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(
    null,
  );
  const [deleteConfirmSessionId, setDeleteConfirmSessionId] = useState<
    string | null
  >(null);
  const [renameDraft, setRenameDraft] = useState("");
  const sortedSessions = useMemo(
    () => sortedSessionsByRecency(sessions),
    [sessions],
  );
  const visibleSessions = useMemo(
    () => filterPiSessions(sortedSessions, search),
    [search, sortedSessions],
  );
  const selectedIndex = Math.max(
    0,
    visibleSessions.findIndex((session) => session.id === selectedSessionId),
  );

  useEffect(() => {
    setDeleteConfirmSessionId((current) =>
      reconcilePiSessionDeleteConfirmationId(current, selectedSessionId),
    );
  }, [selectedSessionId]);

  const selectSessionAt = (index: number, target: HTMLElement) => {
    const nextSession = visibleSessions[index];
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
    const lastIndex = visibleSessions.length - 1;
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

  const beginRename = (session: PiSession) => {
    setDeleteConfirmSessionId(null);
    setRenamingSessionId(session.id);
    setRenameDraft(session.title);
  };

  const cancelRename = () => {
    setRenamingSessionId(null);
    setRenameDraft("");
  };

  const submitRename = (session: PiSession) => {
    const title = renameDraft.replace(/\s+/g, " ").trim();
    if (title && title !== session.title) {
      onRenameSession(session.id, title);
    }
    cancelRename();
  };

  return (
    <PiSection
      title="Sessions"
      collapsed={collapsed}
      summary={
        <Badge
          variant="outline"
          className="h-4 min-w-4 rounded-md px-1 text-[9.5px] text-muted-foreground"
        >
          {sessions.length}
        </Badge>
      }
      actions={
        <Button
          size="xs"
          variant="ghost"
          className="h-5 rounded-md px-1.5 text-[10px]"
          disabled={!canCreateSession || disabled}
          onClick={onCreateSession}
        >
          New
        </Button>
      }
      onCollapsedChange={onCollapsedChange}
    >
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
                className="h-6 rounded-md text-[10.5px]"
                disabled={disabled}
                onClick={onCreateSession}
              >
                Create session
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <>
          {sessions.length > 3 ? (
            <div className="px-2 pb-1">
              <input
                aria-label="Filter Pi sessions"
                className="h-7 w-full rounded-md border border-border/45 bg-background/85 px-2 text-[11px] outline-none placeholder:text-muted-foreground/55 focus-visible:border-primary/45 focus-visible:ring-2 focus-visible:ring-primary/15"
                placeholder="Filter sessions"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          ) : null}
          {visibleSessions.length === 0 ? (
            <div className="px-4 pb-5 pt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
              No Pi sessions match “{search.trim()}”.
            </div>
          ) : (
            <div
              role="listbox"
              aria-label="Pi sessions"
              className="flex max-h-44 min-h-0 flex-col gap-1 overflow-y-auto px-2 pb-2"
            >
              {visibleSessions.map((session, index) => {
                const selected = selectedSessionId === session.id;
                const cwdLabel = pathBasename(session.cwd) ?? "No workspace";
                const updatedLabel = formatUpdatedAt(session);
                const latestPrompt = promptPreview(session);
                const isRenaming = renamingSessionId === session.id;
                const canResumeSession =
                  session.status === "stopped" &&
                  Boolean(session.sdkSessionFile);
                const canContinueInNewSession =
                  session.status === "stopped" && !session.sdkSessionFile;
                const rowClassName = cn(
                  "flex min-h-[30px] w-full min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-left transition-colors",
                  selected
                    ? "border-border/70 bg-foreground/[0.07] text-foreground"
                    : "border-border/35 bg-background/70 text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
                );

                return (
                  <div key={session.id} role="group" className={rowClassName}>
                    {isRenaming ? (
                      <form
                        className="flex min-w-0 flex-1 items-center gap-1.5"
                        onSubmit={(event) => {
                          event.preventDefault();
                          submitRename(session);
                        }}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            sessionStatusDotClass(session.status),
                          )}
                        />
                        <input
                          aria-label={`Rename Pi session ${session.title}`}
                          className="h-6 min-w-0 flex-1 rounded-md border border-border/50 bg-background/95 px-2 text-[11.5px] text-foreground outline-none focus-visible:border-primary/45 focus-visible:ring-2 focus-visible:ring-primary/15"
                          value={renameDraft}
                          onChange={(event) =>
                            setRenameDraft(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              cancelRename();
                            }
                          }}
                        />
                        <Button
                          type="submit"
                          size="icon-xs"
                          variant="ghost"
                          className="size-6 rounded-md"
                          disabled={disabled}
                          aria-label={`Save Pi session ${session.title}`}
                        >
                          <HugeiconsIcon
                            icon={Tick02Icon}
                            size={12}
                            strokeWidth={1.9}
                          />
                        </Button>
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          className="size-6 rounded-md"
                          aria-label={`Cancel renaming Pi session ${session.title}`}
                          onClick={cancelRename}
                        >
                          <HugeiconsIcon
                            icon={Cancel01Icon}
                            size={12}
                            strokeWidth={1.9}
                          />
                        </Button>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          aria-label={sessionOptionLabel(session)}
                          data-pi-session-option
                          tabIndex={
                            selected || index === selectedIndex ? 0 : -1
                          }
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
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
                            <span className="block truncate text-[10px] text-muted-foreground">
                              <span className="capitalize">
                                {session.status}
                              </span>{" "}
                              · {cwdLabel} · {updatedLabel}
                            </span>
                            {latestPrompt ? (
                              <span className="block truncate text-[10px] text-muted-foreground/85">
                                {latestPrompt}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        {selected ? (
                          deleteConfirmSessionId === session.id ? (
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                type="button"
                                size="xs"
                                variant="destructive"
                                className="h-6 rounded-md px-1.5 text-[10px]"
                                disabled={disabled}
                                aria-label={`Confirm delete Pi session ${session.title}`}
                                onClick={() => {
                                  setDeleteConfirmSessionId(null);
                                  onDeleteSession(session.id);
                                }}
                              >
                                Delete
                              </Button>
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                className="size-6 rounded-md"
                                aria-label={`Cancel delete Pi session ${session.title}`}
                                onClick={() => setDeleteConfirmSessionId(null)}
                              >
                                <HugeiconsIcon
                                  icon={Cancel01Icon}
                                  size={12}
                                  strokeWidth={1.9}
                                />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex shrink-0 items-center gap-0.5">
                              {canResumeSession ? (
                                <Button
                                  type="button"
                                  size="xs"
                                  variant="ghost"
                                  className="h-6 rounded-md px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                                  disabled={disabled}
                                  aria-label={`Resume Pi session ${session.title}`}
                                  onClick={() => onResumeSession(session.id)}
                                >
                                  Resume
                                </Button>
                              ) : canContinueInNewSession ? (
                                <Button
                                  type="button"
                                  size="xs"
                                  variant="ghost"
                                  className="h-6 rounded-md px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                                  disabled={disabled}
                                  aria-label={`Continue Pi session ${session.title} in a new session`}
                                  title="Continue in a new session"
                                  onClick={onCreateSession}
                                >
                                  New
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                className="size-6 rounded-md text-muted-foreground hover:text-foreground"
                                disabled={disabled}
                                aria-label={`Rename Pi session ${session.title}`}
                                onClick={() => beginRename(session)}
                              >
                                <HugeiconsIcon
                                  icon={Edit02Icon}
                                  size={12}
                                  strokeWidth={1.9}
                                />
                              </Button>
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                className="size-6 rounded-md text-muted-foreground hover:text-destructive"
                                disabled={disabled}
                                aria-label={`Delete Pi session ${session.title}`}
                                onClick={() => {
                                  const next =
                                    nextPiSessionDeleteConfirmationId(
                                      deleteConfirmSessionId,
                                      session.id,
                                    );
                                  if (next.shouldDelete) {
                                    onDeleteSession(session.id);
                                  } else {
                                    setDeleteConfirmSessionId(
                                      next.nextSessionId,
                                    );
                                  }
                                }}
                              >
                                <HugeiconsIcon
                                  icon={Delete02Icon}
                                  size={12}
                                  strokeWidth={1.9}
                                />
                              </Button>
                            </div>
                          )
                        ) : null}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </PiSection>
  );
}
