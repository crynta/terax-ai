import { AiChat02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { listen } from "@tauri-apps/api/event";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { piNative } from "./lib/native";
import type { PiSession, PiSessionEvent } from "./lib/sessions";
import { buildPiSessionTranscript, upsertPiSession } from "./lib/sessions";
import {
  getPiStatusView,
  type PiDiagnostics,
  type PiRuntimeState,
  type PiStatusView,
} from "./lib/status";

const INITIAL_PI_STATE: PiRuntimeState = {
  phase: "disconnected",
  detail: null,
};

function statusDotClass(tone: PiStatusView["tone"]): string {
  switch (tone) {
    case "success":
      return "bg-emerald-500/80";
    case "progress":
      return "bg-sky-500/80";
    case "error":
      return "bg-destructive";
    case "muted":
      return "bg-muted-foreground/35";
  }
}

function sessionDotClass(status: PiSession["status"]): string {
  switch (status) {
    case "running":
      return "bg-sky-500/80";
    case "idle":
      return "bg-emerald-500/75";
    case "stopped":
      return "bg-muted-foreground/35";
    case "error":
      return "bg-destructive";
  }
}

function toErrorState(error: unknown): PiRuntimeState {
  return {
    phase: "error",
    detail: error instanceof Error ? error.message : String(error),
  };
}

function transcriptItemClass(kind: "assistant" | "error" | "system" | "user") {
  switch (kind) {
    case "assistant":
      return "border-emerald-500/20 bg-emerald-500/5";
    case "user":
      return "border-primary/25 bg-primary/10";
    case "error":
      return "border-destructive/35 bg-destructive/10";
    case "system":
      return "border-border/35 bg-card/60";
  }
}

export function PiPanel() {
  const [runtimeState, setRuntimeState] = useState(INITIAL_PI_STATE);
  const [diagnostics, setDiagnostics] = useState<PiDiagnostics | null>(null);
  const [sessions, setSessions] = useState<PiSession[]>([]);
  const [sessionEvents, setSessionEvents] = useState<PiSessionEvent[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [prompt, setPrompt] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const status = getPiStatusView(runtimeState);
  const runtimeReady = runtimeState.phase === "ready";
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );
  const selectedEvents = useMemo(
    () =>
      selectedSessionId === null
        ? []
        : sessionEvents.filter(
            (event) => event.sessionId === selectedSessionId,
          ),
    [selectedSessionId, sessionEvents],
  );
  const selectedTranscript = useMemo(
    () => buildPiSessionTranscript(selectedEvents),
    [selectedEvents],
  );
  const loadedPackageCount =
    diagnostics?.piPackages.filter((pkg) => pkg.loaded).length ?? 0;
  const configuredApiKeyCount =
    diagnostics?.config.apiKeys.filter((key) => key.configured).length ?? 0;

  const applySessionEvents = useCallback((events: PiSessionEvent[]) => {
    if (events.length === 0) {
      return;
    }

    setSessionEvents((current) => {
      const next: PiSessionEvent[] = [];
      const seen = new Set<string>();
      for (const event of [...events, ...current]) {
        if (seen.has(event.id)) {
          continue;
        }
        seen.add(event.id);
        next.push(event);
      }
      return next.slice(0, 100);
    });

    setSessions((current) =>
      current.map((session) => {
        let next = session;
        for (const event of events) {
          if (event.sessionId !== session.id) {
            continue;
          }
          if (
            event.type === "session.status" &&
            typeof event.payload.status === "string"
          ) {
            next = {
              ...next,
              status: event.payload.status as PiSession["status"],
              updatedAt: event.createdAt,
            };
          }
          if (event.type === "session.error") {
            next = { ...next, status: "error", updatedAt: event.createdAt };
          }
        }
        return next;
      }),
    );
  }, []);

  const applySessionUpdate = useCallback(
    (session: PiSession, events: PiSessionEvent[]) => {
      setSessions((current) => upsertPiSession(current, session));
      applySessionEvents(events);
      setSelectedSessionId(session.id);
    },
    [applySessionEvents],
  );

  const refreshStatus = useCallback(async () => {
    try {
      setRuntimeState(await piNative.status());
    } catch (error) {
      setRuntimeState(toErrorState(error));
    }
  }, []);

  const applySessionList = useCallback(
    (result: { sessions: PiSession[]; events: PiSessionEvent[] }) => {
      setSessions(result.sessions);
      applySessionEvents(result.events);
      setSelectedSessionId((current) =>
        current !== null &&
        result.sessions.some((session) => session.id === current)
          ? current
          : (result.sessions[0]?.id ?? null),
      );
    },
    [applySessionEvents],
  );

  const refreshSessions = useCallback(async () => {
    try {
      applySessionList(await piNative.sessionsList());
    } catch (error) {
      setRuntimeState(toErrorState(error));
    }
  }, [applySessionList]);

  const refreshHistory = useCallback(async () => {
    try {
      applySessionList(await piNative.sessionsHistory());
    } catch {
      // History is best-effort; runtime status errors remain more actionable.
    }
  }, [applySessionList]);

  const refreshDiagnostics = useCallback(async () => {
    try {
      setDiagnostics(await piNative.diagnostics());
    } catch {
      setDiagnostics(null);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    void refreshHistory();
  }, [refreshHistory, refreshStatus]);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen<PiSessionEvent>("pi:session-event", (event) => {
      applySessionEvents([event.payload]);
    })
      .then((nextUnlisten) => {
        if (alive) {
          unlisten = nextUnlisten;
        } else {
          nextUnlisten();
        }
      })
      .catch(() => {});

    return () => {
      alive = false;
      unlisten?.();
    };
  }, [applySessionEvents]);

  const startRuntime = useCallback(async () => {
    setIsBusy(true);
    setRuntimeState({ phase: "starting", detail: "Starting Pi" });
    try {
      setRuntimeState(await piNative.start());
      await refreshSessions();
      await refreshDiagnostics();
    } catch (error) {
      setRuntimeState(toErrorState(error));
    } finally {
      setIsBusy(false);
    }
  }, [refreshDiagnostics, refreshSessions]);

  const stopRuntime = useCallback(async () => {
    setIsBusy(true);
    try {
      setRuntimeState(await piNative.stop());
      setSessions([]);
      setSessionEvents([]);
      setSelectedSessionId(null);
      setDiagnostics(null);
    } catch (error) {
      setRuntimeState(toErrorState(error));
    } finally {
      setIsBusy(false);
    }
  }, []);

  const restartRuntime = useCallback(async () => {
    setIsBusy(true);
    setRuntimeState({ phase: "starting", detail: "Restarting Pi" });
    try {
      await piNative.stop();
      setSessions([]);
      setSessionEvents([]);
      setSelectedSessionId(null);
      setRuntimeState(await piNative.start());
      await refreshSessions();
      await refreshDiagnostics();
    } catch (error) {
      setRuntimeState(toErrorState(error));
    } finally {
      setIsBusy(false);
    }
  }, [refreshDiagnostics, refreshSessions]);

  const createSession = useCallback(async () => {
    setIsBusy(true);
    try {
      const result = await piNative.sessionCreate();
      applySessionUpdate(result.session, result.events);
      await refreshStatus();
    } catch (error) {
      setRuntimeState(toErrorState(error));
    } finally {
      setIsBusy(false);
    }
  }, [applySessionUpdate, refreshStatus]);

  const sendPrompt = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const text = prompt.trim();
      if (selectedSession === null || text === "") {
        return;
      }

      setIsBusy(true);
      try {
        const result = await piNative.sessionSend(selectedSession.id, text);
        applySessionUpdate(result.session, result.events);
        setPrompt("");
      } catch (error) {
        setRuntimeState(toErrorState(error));
      } finally {
        setIsBusy(false);
      }
    },
    [applySessionUpdate, prompt, selectedSession],
  );

  const stopSelectedSession = useCallback(async () => {
    if (selectedSession === null) {
      return;
    }

    setIsBusy(true);
    try {
      const result = await piNative.sessionStop(selectedSession.id);
      applySessionUpdate(result.session, result.events);
    } catch (error) {
      setRuntimeState(toErrorState(error));
    } finally {
      setIsBusy(false);
    }
  }, [applySessionUpdate, selectedSession]);

  return (
    <aside
      aria-label="Pi sessions"
      className="flex h-full min-w-0 flex-col bg-card/80 backdrop-blur [contain:layout_style]"
    >
      <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-2">
        <div className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-foreground/5 px-2 py-1 text-[11.5px] font-medium leading-none text-foreground">
          <HugeiconsIcon
            icon={AiChat02Icon}
            size={12}
            strokeWidth={1.9}
            className="shrink-0 text-muted-foreground"
          />
          <span className="truncate">Pi</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 rounded-md border border-border/55 px-1.5 py-0.5 text-[10.5px] font-medium leading-none text-muted-foreground">
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              statusDotClass(status.tone),
            )}
          />
          <span>{status.label}</span>
        </div>
      </header>

      <div className="shrink-0 border-b border-border/40 bg-gradient-to-b from-card/65 to-card/30 px-2.5 py-2.5">
        <div className="rounded-lg border border-border/45 bg-background/95 px-2.5 py-2 shadow-sm">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[12px] font-medium text-foreground">
              Runtime
            </span>
            <span className="ml-auto shrink-0 text-[10.5px] font-medium text-muted-foreground">
              {status.canStart ? "Idle" : "Active"}
            </span>
          </div>
          <p className="mt-1 text-[10.5px] leading-snug text-muted-foreground">
            {runtimeState.detail ??
              "Connect the Pi runtime to show active sessions in this sidebar."}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <Button
              size="xs"
              className="h-6"
              disabled={!status.canStart || isBusy}
              onClick={() => void startRuntime()}
            >
              Start
            </Button>
            <Button
              size="xs"
              variant="outline"
              className="h-6"
              disabled={!status.canStop || isBusy}
              onClick={() => void stopRuntime()}
            >
              Stop
            </Button>
            <Button
              size="xs"
              variant="outline"
              className="h-6"
              disabled={isBusy}
              onClick={() => void restartRuntime()}
            >
              Restart
            </Button>
          </div>
          {diagnostics ? (
            <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 border-t border-border/35 pt-2 text-[10px] leading-none text-muted-foreground">
              <span className="truncate">Node {diagnostics.node.version}</span>
              <span className="truncate text-right">
                PID {diagnostics.node.pid}
              </span>
              <span className="truncate">
                Pi packages {loadedPackageCount}/{diagnostics.piPackages.length}
              </span>
              <span className="truncate text-right">
                API keys {configuredApiKeyCount}/
                {diagnostics.config.apiKeys.length}
              </span>
              <span className="col-span-2 truncate">
                Tools: {diagnostics.config.toolMode}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-7 shrink-0 items-center gap-2 px-3">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/85">
            Sessions
          </span>
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border/60 px-1 text-[9.5px] font-semibold tabular-nums text-muted-foreground">
            {sessions.length}
          </span>
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto h-5 rounded-md px-1.5 text-[10px]"
            disabled={!runtimeReady || isBusy}
            onClick={() => void createSession()}
          >
            New
          </Button>
        </div>

        {sessions.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 px-4 text-center">
            <div className="flex size-8 items-center justify-center rounded-full border border-border/55 text-muted-foreground">
              <HugeiconsIcon icon={AiChat02Icon} size={16} strokeWidth={1.6} />
            </div>
            <div className="text-[12px] font-medium text-foreground">
              No Pi sessions
            </div>
            <div className="max-w-52 text-[10.5px] leading-snug text-muted-foreground">
              Create a session to exercise the Pi protocol stub.
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 shrink-0 space-y-1 overflow-y-auto border-b border-border/35 px-2 pb-2">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={cn(
                    "flex w-full min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
                    selectedSessionId === session.id
                      ? "border-primary/35 bg-primary/10"
                      : "border-border/35 bg-background/75 hover:bg-muted/60",
                  )}
                  onClick={() => setSelectedSessionId(session.id)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      sessionDotClass(session.status),
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium text-foreground">
                      {session.title}
                    </span>
                    <span className="block truncate text-[10px] capitalize text-muted-foreground">
                      {session.status}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            <div className="flex min-h-0 flex-1 flex-col px-2 py-2">
              <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border/40 bg-background/70">
                <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border/35 px-2">
                  <span className="truncate text-[11px] font-medium text-foreground">
                    {selectedSession?.title ?? "Session"}
                  </span>
                  <span className="ml-auto text-[10px] capitalize text-muted-foreground">
                    {selectedSession?.status ?? "idle"}
                  </span>
                </div>
                <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                  {selectedTranscript.length === 0 ? (
                    <div className="py-4 text-center text-[10.5px] text-muted-foreground">
                      No session events yet.
                    </div>
                  ) : (
                    selectedTranscript.map((item) => (
                      <div
                        key={item.id}
                        className={cn(
                          "rounded-md border px-2 py-1",
                          transcriptItemClass(item.kind),
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-[10.5px] font-medium text-foreground">
                            {item.label}
                          </span>
                          <span className="ml-auto shrink-0 text-[9.5px] text-muted-foreground">
                            {item.eventIds[item.eventIds.length - 1]}
                          </span>
                        </div>
                        {item.text !== null ? (
                          <p className="mt-0.5 whitespace-pre-wrap text-[10px] leading-snug text-muted-foreground">
                            {item.text}
                          </p>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <form
              className="shrink-0 border-t border-border/35 p-2"
              onSubmit={(event) => void sendPrompt(event)}
            >
              <textarea
                className="min-h-14 w-full resize-none rounded-md border border-border/45 bg-background px-2 py-1.5 text-[11px] leading-snug text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-primary/45 focus:ring-2 focus:ring-primary/15"
                value={prompt}
                placeholder="Send a prompt to the selected Pi session…"
                disabled={!runtimeReady || selectedSession === null || isBusy}
                onChange={(event) => setPrompt(event.target.value)}
              />
              <div className="mt-1.5 flex items-center gap-1.5">
                <Button
                  type="submit"
                  size="xs"
                  className="h-6 flex-1"
                  disabled={
                    !runtimeReady ||
                    selectedSession === null ||
                    prompt.trim() === "" ||
                    isBusy
                  }
                >
                  Send
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  className="h-6 flex-1"
                  disabled={
                    !runtimeReady ||
                    selectedSession === null ||
                    selectedSession.status === "stopped" ||
                    isBusy
                  }
                  onClick={() => void stopSelectedSession()}
                >
                  Stop
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </aside>
  );
}
