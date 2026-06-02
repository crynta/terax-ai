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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { statusToneDotClass } from "@/modules/pi/components/classes";
import { PiComposer } from "@/modules/pi/components/PiComposer";
import { PiContextBar } from "@/modules/pi/components/PiContextBar";
import { PiRuntimeCard } from "@/modules/pi/components/PiRuntimeCard";
import { PiSessionList } from "@/modules/pi/components/PiSessionList";
import { PiTranscript } from "@/modules/pi/components/PiTranscript";
import { piNative } from "@/modules/pi/lib/native";
import type {
  PiPromptContext,
  PiSession,
  PiSessionEvent,
} from "@/modules/pi/lib/sessions";
import {
  applyPiSessionEvents,
  buildPiSessionTranscript,
  mergePiSessionEvents,
  upsertPiSession,
} from "@/modules/pi/lib/sessions";
import {
  getPiStatusView,
  type PiDiagnostics,
  type PiRuntimeState,
} from "@/modules/pi/lib/status";
import { buildPiContextPreview } from "@/modules/pi/lib/view";

const INITIAL_PI_STATE: PiRuntimeState = {
  phase: "disconnected",
  detail: null,
};

function toErrorState(error: unknown): PiRuntimeState {
  return {
    phase: "error",
    detail: error instanceof Error ? error.message : String(error),
  };
}

type PiPanelProps = {
  workspaceRoot?: string | null;
  activeCwd?: string | null;
  activeFile?: string | null;
  activeTerminalPrivate?: boolean;
};

export function PiPanel({
  workspaceRoot = null,
  activeCwd = null,
  activeFile = null,
  activeTerminalPrivate = false,
}: PiPanelProps) {
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
  const canCreateSession = runtimeReady && workspaceRoot !== null;
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
  const promptContext = useMemo<PiPromptContext>(
    () => ({
      workspaceRoot: selectedSession?.cwd ?? workspaceRoot,
      activeTerminalCwd: activeCwd,
      activeFile,
      activeTerminalPrivate,
    }),
    [
      activeCwd,
      activeFile,
      activeTerminalPrivate,
      selectedSession?.cwd,
      workspaceRoot,
    ],
  );
  const contextPreview = useMemo(
    () => buildPiContextPreview(promptContext, selectedSession?.cwd),
    [promptContext, selectedSession?.cwd],
  );

  const applySessionEvents = useCallback((events: PiSessionEvent[]) => {
    if (events.length === 0) {
      return;
    }

    setSessionEvents((current) => mergePiSessionEvents(current, events));

    setSessions((current) => applyPiSessionEvents(current, events));
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
    } catch {}
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
      const result = await piNative.sessionCreate(undefined, workspaceRoot);
      applySessionUpdate(result.session, result.events);
      await refreshStatus();
    } catch (error) {
      setRuntimeState(toErrorState(error));
    } finally {
      setIsBusy(false);
    }
  }, [applySessionUpdate, refreshStatus, workspaceRoot]);

  const sendPrompt = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const text = prompt.trim();
      if (selectedSession === null || text === "") {
        return;
      }

      setIsBusy(true);
      try {
        const result = await piNative.sessionSend(
          selectedSession.id,
          text,
          promptContext,
        );
        applySessionUpdate(result.session, result.events);
        setPrompt("");
      } catch (error) {
        setRuntimeState(toErrorState(error));
      } finally {
        setIsBusy(false);
      }
    },
    [applySessionUpdate, prompt, promptContext, selectedSession],
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
        <Badge
          variant="outline"
          className="h-5 gap-1 border-border/55 px-1.5 text-[10.5px] text-muted-foreground"
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              statusToneDotClass(status.tone),
            )}
          />
          {status.label}
        </Badge>
      </header>

      <PiRuntimeCard
        diagnostics={diagnostics}
        isBusy={isBusy}
        runtimeState={runtimeState}
        status={status}
        onStart={() => void startRuntime()}
        onStop={() => void stopRuntime()}
        onRestart={() => void restartRuntime()}
      />

      <PiContextBar items={contextPreview} />

      <div className="flex min-h-0 flex-1 flex-col">
        <PiSessionList
          canCreateSession={canCreateSession}
          disabled={isBusy}
          runtimeReady={runtimeReady}
          selectedSessionId={selectedSessionId}
          sessions={sessions}
          workspaceRoot={workspaceRoot}
          onCreateSession={() => void createSession()}
          onSelectSession={setSelectedSessionId}
        />

        <PiTranscript
          selectedSession={selectedSession}
          transcript={selectedTranscript}
        />

        <PiComposer
          disabled={!runtimeReady || selectedSession === null || isBusy}
          isBusy={isBusy}
          prompt={prompt}
          runtimeReady={runtimeReady}
          selectedSession={selectedSession}
          onPromptChange={setPrompt}
          onSendPrompt={(event) => void sendPrompt(event)}
          onStopSession={() => void stopSelectedSession()}
        />
      </div>
    </aside>
  );
}
