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
import { PiDiagnosticsCard } from "@/modules/pi/components/PiDiagnosticsCard";
import { PiRuntimeCard } from "@/modules/pi/components/PiRuntimeCard";
import { PiSessionList } from "@/modules/pi/components/PiSessionList";
import { PiTranscript } from "@/modules/pi/components/PiTranscript";
import { buildPiDiagnosticsView } from "@/modules/pi/lib/diagnostics";
import { piNative } from "@/modules/pi/lib/native";
import {
  type PiProviderPrefs,
  resolvePiProviderConfig,
} from "@/modules/pi/lib/provider";
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
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";

const INITIAL_PI_STATE: PiRuntimeState = {
  phase: "disconnected",
  detail: null,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toErrorState(error: unknown): PiRuntimeState {
  return {
    phase: "error",
    detail: errorMessage(error),
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
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [isDiagnosticsRefreshing, setIsDiagnosticsRefreshing] = useState(false);
  const [sessions, setSessions] = useState<PiSession[]>([]);
  const [sessionEvents, setSessionEvents] = useState<PiSessionEvent[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [prompt, setPrompt] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const piModelId = usePreferencesStore((state) => state.piModelId);
  const lmstudioBaseURL = usePreferencesStore((state) => state.lmstudioBaseURL);
  const lmstudioModelId = usePreferencesStore((state) => state.lmstudioModelId);
  const mlxBaseURL = usePreferencesStore((state) => state.mlxBaseURL);
  const mlxModelId = usePreferencesStore((state) => state.mlxModelId);
  const ollamaBaseURL = usePreferencesStore((state) => state.ollamaBaseURL);
  const ollamaModelId = usePreferencesStore((state) => state.ollamaModelId);
  const openaiCompatibleBaseURL = usePreferencesStore(
    (state) => state.openaiCompatibleBaseURL,
  );
  const openaiCompatibleModelId = usePreferencesStore(
    (state) => state.openaiCompatibleModelId,
  );
  const openaiCompatibleContextLimit = usePreferencesStore(
    (state) => state.openaiCompatibleContextLimit,
  );
  const openrouterModelId = usePreferencesStore(
    (state) => state.openrouterModelId,
  );
  const customEndpoints = usePreferencesStore((state) => state.customEndpoints);
  const status = getPiStatusView(runtimeState);
  const runtimeReady = runtimeState.phase === "ready";
  const piProviderPrefs = useMemo<PiProviderPrefs>(
    () => ({
      piModelId,
      lmstudioBaseURL,
      lmstudioModelId,
      mlxBaseURL,
      mlxModelId,
      ollamaBaseURL,
      ollamaModelId,
      openaiCompatibleBaseURL,
      openaiCompatibleModelId,
      openaiCompatibleContextLimit,
      openrouterModelId,
      customEndpoints,
    }),
    [
      customEndpoints,
      lmstudioBaseURL,
      lmstudioModelId,
      mlxBaseURL,
      mlxModelId,
      ollamaBaseURL,
      ollamaModelId,
      openaiCompatibleBaseURL,
      openaiCompatibleContextLimit,
      openaiCompatibleModelId,
      openrouterModelId,
      piModelId,
    ],
  );
  const piProvider = useMemo(
    () => resolvePiProviderConfig(piProviderPrefs),
    [piProviderPrefs],
  );
  const canCreateSession =
    runtimeReady && workspaceRoot !== null && piProvider.ok;
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
  const diagnosticsView = useMemo(
    () =>
      buildPiDiagnosticsView({
        diagnostics,
        diagnosticsError,
        provider: piProvider,
        runtimeState,
        workspaceRoot,
      }),
    [diagnostics, diagnosticsError, piProvider, runtimeState, workspaceRoot],
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
      setDiagnosticsError(null);
    } catch (error) {
      setDiagnostics(null);
      setDiagnosticsError(errorMessage(error));
    }
  }, []);

  const refreshPanelDiagnostics = useCallback(async () => {
    setIsDiagnosticsRefreshing(true);
    try {
      const nextState = await piNative.status();
      setRuntimeState(nextState);
      if (nextState.phase === "ready") {
        await refreshSessions();
        await refreshDiagnostics();
      } else {
        setDiagnostics(null);
        setDiagnosticsError(null);
      }
    } catch (error) {
      setRuntimeState(toErrorState(error));
      setDiagnostics(null);
      setDiagnosticsError(errorMessage(error));
    } finally {
      setIsDiagnosticsRefreshing(false);
    }
  }, [refreshDiagnostics, refreshSessions]);

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
    setDiagnostics(null);
    setDiagnosticsError(null);
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
      setDiagnosticsError(null);
    } catch (error) {
      setRuntimeState(toErrorState(error));
    } finally {
      setIsBusy(false);
    }
  }, []);

  const restartRuntime = useCallback(async () => {
    setIsBusy(true);
    setDiagnosticsError(null);
    setRuntimeState({ phase: "starting", detail: "Restarting Pi" });
    try {
      await piNative.stop();
      setSessions([]);
      setSessionEvents([]);
      setSelectedSessionId(null);
      setDiagnostics(null);
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
    if (!piProvider.ok) {
      setDiagnosticsError(piProvider.error);
      return;
    }

    setIsBusy(true);
    try {
      const result = await piNative.sessionCreate(
        undefined,
        workspaceRoot,
        piProvider.config,
      );
      applySessionUpdate(result.session, result.events);
      await refreshStatus();
    } catch (error) {
      setRuntimeState(toErrorState(error));
    } finally {
      setIsBusy(false);
    }
  }, [applySessionUpdate, piProvider, refreshStatus, workspaceRoot]);

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

  const openModelSettings = useCallback(() => {
    void openSettingsWindow("models");
  }, []);

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
        isBusy={isBusy}
        runtimeState={runtimeState}
        status={status}
        onStart={() => void startRuntime()}
        onStop={() => void stopRuntime()}
        onRestart={() => void restartRuntime()}
      />

      <PiDiagnosticsCard
        disabled={isBusy || isDiagnosticsRefreshing}
        isRefreshing={isDiagnosticsRefreshing}
        view={diagnosticsView}
        onOpenSettings={openModelSettings}
        onRefresh={() => void refreshPanelDiagnostics()}
        onStartRuntime={() => void startRuntime()}
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
