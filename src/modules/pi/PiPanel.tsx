import { AiChat02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { listen } from "@tauri-apps/api/event";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { providerNeedsKey, providerSupportsKey } from "@/modules/ai/config";
import { getCustomEndpointKey, getKey } from "@/modules/ai/lib/keyring";
import { statusToneDotClass } from "@/modules/pi/components/classes";
import { PiComposer } from "@/modules/pi/components/PiComposer";
import { PiContextBar } from "@/modules/pi/components/PiContextBar";
import { PiDiagnosticsCard } from "@/modules/pi/components/PiDiagnosticsCard";
import { PiRuntimeCard } from "@/modules/pi/components/PiRuntimeCard";
import { PiSessionList } from "@/modules/pi/components/PiSessionList";
import { PiTranscript } from "@/modules/pi/components/PiTranscript";
import type { PiProviderKeyStatus } from "@/modules/pi/lib/diagnostics";
import { shouldPrewarmPiRuntime } from "@/modules/pi/lib/lifecycle";
import { piNative } from "@/modules/pi/lib/native";
import { buildPiPanelState } from "@/modules/pi/lib/panel-state";
import {
  type PiProviderPrefs,
  resolvePiProviderConfig,
} from "@/modules/pi/lib/provider";
import type { PiSession, PiSessionEvent } from "@/modules/pi/lib/sessions";
import {
  applyPiSessionEvents,
  MAX_PI_PROMPT_CHARS,
  markPiSessionsStopped,
  mergePiSessionEvents,
  mergePiSessionSnapshots,
  upsertPiSession,
} from "@/modules/pi/lib/sessions";
import type { PiDiagnostics, PiRuntimeState } from "@/modules/pi/lib/status";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { onKeysChanged } from "@/modules/settings/store";

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

type PiPanelSectionId = "diagnostics" | "sessions" | "context";
type PiPanelSectionCollapseState = Record<PiPanelSectionId, boolean>;

const INITIAL_SECTION_COLLAPSED = {
  diagnostics: true,
  sessions: true,
  context: true,
} satisfies PiPanelSectionCollapseState;

export function PiPanel({
  workspaceRoot = null,
  activeCwd = null,
  activeFile = null,
  activeTerminalPrivate = false,
}: PiPanelProps) {
  const [runtimeState, setRuntimeState] = useState(INITIAL_PI_STATE);
  const [diagnostics, setDiagnostics] = useState<PiDiagnostics | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isDiagnosticsRefreshing, setIsDiagnosticsRefreshing] = useState(false);
  const [sessions, setSessions] = useState<PiSession[]>([]);
  const [sessionEvents, setSessionEvents] = useState<PiSessionEvent[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  );
  const [prompt, setPrompt] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [collapsedSections, setCollapsedSections] =
    useState<PiPanelSectionCollapseState>(INITIAL_SECTION_COLLAPSED);
  const [providerKeyStatus, setProviderKeyStatus] = useState<
    PiProviderKeyStatus | undefined
  >(undefined);
  const [keyRefreshToken, setKeyRefreshToken] = useState(0);
  const prewarmAttemptedRef = useRef(false);
  const piAuthMode = usePreferencesStore((state) => state.piAuthMode);
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
  const piProviderPrefs = useMemo<PiProviderPrefs>(
    () => ({
      piAuthMode,
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
      piAuthMode,
      piModelId,
    ],
  );
  const piProvider = useMemo(
    () => resolvePiProviderConfig(piProviderPrefs),
    [piProviderPrefs],
  );
  const panelState = useMemo(
    () =>
      buildPiPanelState({
        activeCwd,
        activeFile,
        activeTerminalPrivate,
        diagnostics,
        diagnosticsError,
        historyError,
        isBusy,
        prompt,
        provider: piProvider,
        providerKeyStatus,
        runtimeState,
        selectedSessionId,
        sessionEvents,
        sessions,
        workspaceRoot,
      }),
    [
      activeCwd,
      activeFile,
      activeTerminalPrivate,
      diagnostics,
      diagnosticsError,
      historyError,
      isBusy,
      piProvider,
      prompt,
      providerKeyStatus,
      runtimeState,
      selectedSessionId,
      sessionEvents,
      sessions,
      workspaceRoot,
    ],
  );
  const status = panelState.runtime.status;
  const runtimeReady = panelState.runtime.ready;
  const canCreateSession = panelState.composer.canCreateSession;
  const selectedSession = panelState.sessions.selected;
  const selectedSessionSendable = panelState.sessions.selectedSendable;
  const selectedTranscript = panelState.sessions.transcript;
  const promptContext = panelState.context.prompt;
  const contextPreview = panelState.context.preview;
  const diagnosticsView = panelState.diagnostics.view;

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    onKeysChanged(() => setKeyRefreshToken((current) => current + 1))
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
  }, []);

  useEffect(() => {
    let alive = true;

    async function refreshProviderKeyStatus() {
      if (!piProvider.ok) {
        setProviderKeyStatus(undefined);
        return;
      }

      if (piProvider.config.authMode === "profile") {
        setProviderKeyStatus({
          configured: null,
          required: false,
          supported: false,
        });
        return;
      }

      const provider = piProvider.config.provider as Parameters<
        typeof providerSupportsKey
      >[0];
      const supported = providerSupportsKey(provider);
      const required = providerNeedsKey(provider);
      if (!supported) {
        setProviderKeyStatus({ configured: null, required, supported });
        return;
      }

      setProviderKeyStatus({ configured: null, required, supported });
      const key = piProvider.config.customEndpointId
        ? await getCustomEndpointKey(piProvider.config.customEndpointId)
        : await getKey(provider);
      if (alive) {
        setProviderKeyStatus({ configured: key !== null, required, supported });
      }
    }

    void refreshProviderKeyStatus();

    return () => {
      alive = false;
    };
  }, [keyRefreshToken, piProvider]);

  const setSectionCollapsed = useCallback(
    (section: PiPanelSectionId, collapsed: boolean) => {
      setCollapsedSections((current) =>
        current[section] === collapsed
          ? current
          : { ...current, [section]: collapsed },
      );
    },
    [],
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

  const applyHistoryList = useCallback(
    (result: { sessions: PiSession[]; events: PiSessionEvent[] }) => {
      setSessionEvents((current) =>
        mergePiSessionEvents(current, result.events),
      );
      setSessions(applyPiSessionEvents(result.sessions, result.events));
    },
    [],
  );

  const applyLiveSessionList = useCallback(
    (result: { sessions: PiSession[]; events: PiSessionEvent[] }) => {
      setSessionEvents((current) =>
        mergePiSessionEvents(current, result.events),
      );
      setSessions((current) =>
        applyPiSessionEvents(
          mergePiSessionSnapshots(current, result.sessions, {
            missingStatus: "stopped",
          }),
          result.events,
        ),
      );
    },
    [],
  );

  const refreshSessions = useCallback(async () => {
    try {
      applyLiveSessionList(await piNative.sessionsList());
    } catch (error) {
      setRuntimeState(toErrorState(error));
    }
  }, [applyLiveSessionList]);

  const refreshHistory = useCallback(async () => {
    try {
      applyHistoryList(await piNative.sessionsHistory());
      setHistoryError(null);
    } catch (error) {
      setHistoryError(`History load failed: ${errorMessage(error)}`);
    }
  }, [applyHistoryList]);

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
      await refreshHistory();
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
  }, [refreshDiagnostics, refreshHistory, refreshSessions]);

  useEffect(() => {
    setSelectedSessionId((current) =>
      current !== null && sessions.some((session) => session.id === current)
        ? current
        : (sessions[0]?.id ?? null),
    );
  }, [sessions]);

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
      await refreshHistory();
      await refreshSessions();
      await refreshDiagnostics();
    } catch (error) {
      setRuntimeState(toErrorState(error));
    } finally {
      setIsBusy(false);
    }
  }, [refreshDiagnostics, refreshHistory, refreshSessions]);

  useEffect(() => {
    if (
      !shouldPrewarmPiRuntime({
        attempted: prewarmAttemptedRef.current,
        isBusy,
        runtimeState,
      })
    ) {
      return;
    }
    prewarmAttemptedRef.current = true;
    void startRuntime();
  }, [isBusy, runtimeState, startRuntime]);

  const stopRuntime = useCallback(async () => {
    setIsBusy(true);
    try {
      setRuntimeState(await piNative.stop());
      setSessions((current) => markPiSessionsStopped(current));
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
      setSessions((current) => markPiSessionsStopped(current));
      setDiagnostics(null);
      setRuntimeState(await piNative.start());
      await refreshHistory();
      await refreshSessions();
      await refreshDiagnostics();
    } catch (error) {
      setRuntimeState(toErrorState(error));
    } finally {
      setIsBusy(false);
    }
  }, [refreshDiagnostics, refreshHistory, refreshSessions]);

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
      if (
        selectedSession === null ||
        !selectedSessionSendable ||
        text === "" ||
        text.length > MAX_PI_PROMPT_CHARS
      ) {
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
    [
      applySessionUpdate,
      prompt,
      promptContext,
      selectedSessionSendable,
      selectedSession,
    ],
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
        collapsed={collapsedSections.diagnostics}
        disabled={isBusy || isDiagnosticsRefreshing}
        isRefreshing={isDiagnosticsRefreshing}
        view={diagnosticsView}
        onCollapsedChange={(collapsed) =>
          setSectionCollapsed("diagnostics", collapsed)
        }
        onOpenSettings={openModelSettings}
        onRefresh={() => void refreshPanelDiagnostics()}
        onStartRuntime={() => void startRuntime()}
      />

      <PiContextBar
        collapsed={collapsedSections.context}
        items={contextPreview}
        onCollapsedChange={(collapsed) =>
          setSectionCollapsed("context", collapsed)
        }
      />

      <div className="flex min-h-0 flex-1 flex-col">
        <PiSessionList
          canCreateSession={canCreateSession}
          collapsed={collapsedSections.sessions}
          disabled={isBusy}
          runtimeReady={runtimeReady}
          selectedSessionId={selectedSessionId}
          sessions={sessions}
          workspaceRoot={workspaceRoot}
          onCollapsedChange={(collapsed) =>
            setSectionCollapsed("sessions", collapsed)
          }
          onCreateSession={() => void createSession()}
          onSelectSession={setSelectedSessionId}
        />

        <PiTranscript
          selectedSession={selectedSession}
          transcript={selectedTranscript}
          onUsePrompt={setPrompt}
        />

        <PiComposer
          disabled={!runtimeReady || !selectedSessionSendable || isBusy}
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
