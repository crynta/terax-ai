import { AiChat02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { IS_WINDOWS } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import { providerNeedsKey, providerSupportsKey } from "@/modules/ai/config";
import { getCustomEndpointKey, getKey } from "@/modules/ai/lib/keyring";
import { statusToneDotClass } from "@/modules/pi/components/classes";
import { PiComposer } from "@/modules/pi/components/PiComposer";
import { PiContextBar } from "@/modules/pi/components/PiContextBar";
import { PiDiagnosticsCard } from "@/modules/pi/components/PiDiagnosticsCard";
import { PiLocalAgentsCard } from "@/modules/pi/components/PiLocalAgentsCard";
import { PiRuntimeCard } from "@/modules/pi/components/PiRuntimeCard";
import { PiSessionList } from "@/modules/pi/components/PiSessionList";
import { PiTranscript } from "@/modules/pi/components/PiTranscript";
import { formatPiErrorDetail } from "@/modules/pi/lib/errors";
import { shouldPrewarmPiRuntime } from "@/modules/pi/lib/lifecycle";
import {
  buildPiLocalAgentLaunchCommand,
  buildPiLocalAgentStatuses,
  type PiLocalAgentLaunchRequest,
  type PiLocalAgentStatus,
  piLocalAgentByName,
} from "@/modules/pi/lib/local-agents";
import { piNative } from "@/modules/pi/lib/native";
import {
  type PiPanelSectionCollapseState,
  type PiPanelSectionId,
  usePiControllerState,
  usePiControllerStore,
} from "@/modules/pi/lib/PiControllerProvider";
import { buildPiPanelState } from "@/modules/pi/lib/panel-state";
import {
  type PiProviderPrefs,
  resolvePiProviderConfig,
} from "@/modules/pi/lib/provider";
import type {
  PiPromptContext,
  PiSession,
  PiSessionBranch,
  PiSessionEvent,
} from "@/modules/pi/lib/sessions";
import {
  annotatePiSessionEventBranch,
  annotatePiSessionEventsBranch,
  applyPiSessionEvents,
  MAX_PI_PROMPT_CHARS,
  markPiSessionsStopped,
  mergePiSessionEvents,
  mergePiSessionSnapshots,
  nextPiRegenerateBranchIndex,
  upsertPiSession,
} from "@/modules/pi/lib/sessions";
import type { PiRuntimeState } from "@/modules/pi/lib/status";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { onKeysChanged } from "@/modules/settings/store";
import { useWorkspaceEnvStore } from "@/modules/workspace";

const INITIAL_PI_STATE: PiRuntimeState = {
  phase: "disconnected",
  detail: null,
};

function errorMessage(error: unknown): string {
  return formatPiErrorDetail(error);
}

function toErrorState(error: unknown): PiRuntimeState {
  return {
    phase: "error",
    detail: errorMessage(error),
  };
}

export type PiFocusRequest = {
  sessionId: string;
  token: number;
};

type PiPanelProps = {
  workspaceRoot?: string | null;
  activeCwd?: string | null;
  activeFile?: string | null;
  activeTerminalPrivate?: boolean;
  focusRequest?: PiFocusRequest | null;
  hideHeader?: boolean;
  onOpenLocalAgent?: (request: PiLocalAgentLaunchRequest) => void;
  onOpenWorkspace?: () => void;
  onPopOut?: () => void;
  onSelectedSessionChange?: (sessionId: string | null) => void;
};

type PiRuntimeAction = "starting" | "stopping" | "restarting" | null;

const INITIAL_SECTION_COLLAPSED = {
  diagnostics: true,
  sessions: true,
  context: true,
  localAgents: true,
} satisfies PiPanelSectionCollapseState;

const INITIAL_LOCAL_AGENT_STATUSES = buildPiLocalAgentStatuses([]);

export function PiPanel({
  workspaceRoot = null,
  activeCwd = null,
  activeFile = null,
  activeTerminalPrivate = false,
  focusRequest = null,
  hideHeader = false,
  onOpenLocalAgent,
  onOpenWorkspace,
  onPopOut,
  onSelectedSessionChange,
}: PiPanelProps) {
  const piControllerStore = usePiControllerStore();
  const [runtimeState, setRuntimeState] = usePiControllerState(
    "runtimeState",
    INITIAL_PI_STATE,
  );
  const [diagnostics, setDiagnostics] = usePiControllerState(
    "diagnostics",
    null,
  );
  const [diagnosticsError, setDiagnosticsError] = usePiControllerState(
    "diagnosticsError",
    null,
  );
  const [historyError, setHistoryError] = usePiControllerState(
    "historyError",
    null,
  );
  const [isDiagnosticsRefreshing, setIsDiagnosticsRefreshing] = useState(false);
  const [sessions, setSessions] = usePiControllerState("sessions", []);
  const [sessionEvents, setSessionEvents] = usePiControllerState(
    "sessionEvents",
    [],
  );
  const [selectedSessionId, setSelectedSessionId] = usePiControllerState(
    "selectedSessionId",
    null,
  );
  const [prompt, setPrompt] = usePiControllerState("prompt", "");
  const [thinkingLevelOverride, setThinkingLevelOverride] =
    usePiControllerState("thinkingLevelOverride", null);
  const [isBusy, setIsBusy] = useState(false);
  const [runtimeAction, setRuntimeAction] = useState<PiRuntimeAction>(null);
  const [collapsedSections, setCollapsedSections] = usePiControllerState(
    "collapsedSections",
    INITIAL_SECTION_COLLAPSED,
  );
  const [providerKeyStatus, setProviderKeyStatus] = usePiControllerState(
    "providerKeyStatus",
    undefined,
  );
  const [localAgents, setLocalAgents] = usePiControllerState(
    "localAgents",
    INITIAL_LOCAL_AGENT_STATUSES,
  );
  const [isLocalAgentsRefreshing, setIsLocalAgentsRefreshing] = useState(false);
  const [keyRefreshToken, setKeyRefreshToken] = usePiControllerState(
    "keyRefreshToken",
    0,
  );
  const activeRegenerateBranchesRef = useRef(
    piControllerStore.regenerateBranches,
  );
  const prewarmAttemptedRef = useRef(piControllerStore.getPrewarmAttempted());

  useEffect(() => {
    return () => {
      piControllerStore.setPrewarmAttempted(prewarmAttemptedRef.current);
    };
  }, [piControllerStore]);

  const terminalAgentSessions = useAgentStore((state) => state.sessions);
  const localAgentState = useAgentStore((state) => state.localAgent);
  const workspaceEnv = useWorkspaceEnvStore((state) => state.env);
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
  const thinkingScope = piProvider.ok
    ? `${piProvider.config.authMode}:${piProvider.config.provider}:${piProvider.config.modelId}:${piProvider.config.sourceModelId}`
    : "unavailable";

  useEffect(() => {
    setThinkingLevelOverride(null);
  }, [selectedSessionId, thinkingScope]);

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
        thinkingLevel: thinkingLevelOverride,
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
      thinkingLevelOverride,
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
  const activeThinkingLevel = panelState.composer.thinkingLevel;
  const localAgentActivities = useMemo(() => {
    const activities = Object.values(terminalAgentSessions).map((agent) => {
      const def = piLocalAgentByName(agent.agent);
      return {
        id: def?.id,
        label: def?.label ?? agent.agent,
        status: agent.status,
        detail: `Terminal ${agent.tabId}`,
      };
    });

    if (localAgentState) {
      const def = piLocalAgentByName(localAgentState.agent);
      const key = def?.id ?? localAgentState.agent.trim().toLowerCase();
      const alreadyShown = activities.some(
        (activity) =>
          (activity.id ?? activity.label.trim().toLowerCase()) === key,
      );
      if (!alreadyShown) {
        activities.unshift({
          id: def?.id,
          label: def?.label ?? localAgentState.agent,
          status: localAgentState.status,
          detail: "Terax agent",
        });
      }
    }

    return activities;
  }, [localAgentState, terminalAgentSessions]);

  const refreshLocalAgents = useCallback(async () => {
    setIsLocalAgentsRefreshing(true);
    try {
      const result = await piNative.localAgentsStatus(workspaceEnv);
      setLocalAgents(buildPiLocalAgentStatuses(result.agents));
    } catch {
      setLocalAgents(INITIAL_LOCAL_AGENT_STATUSES);
    } finally {
      setIsLocalAgentsRefreshing(false);
    }
  }, [workspaceEnv]);

  useEffect(() => {
    void refreshLocalAgents();
  }, [refreshLocalAgents]);

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

    const annotatedEvents = events.map((event) => {
      const branch = activeRegenerateBranchesRef.current.get(event.sessionId);
      const nextEvent = branch
        ? annotatePiSessionEventBranch(event, branch)
        : event;
      if (
        event.type === "session.deleted" ||
        event.type === "session.error" ||
        event.type === "session.output.text" ||
        (event.type === "session.status" && event.payload.status !== "running")
      ) {
        activeRegenerateBranchesRef.current.delete(event.sessionId);
      }
      return nextEvent;
    });

    setSessionEvents((current) =>
      mergePiSessionEvents(current, annotatedEvents),
    );

    setSessions((current) => applyPiSessionEvents(current, annotatedEvents));
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
    if (focusRequest) {
      setSelectedSessionId(focusRequest.sessionId);
    }
  }, [focusRequest]);

  useEffect(() => {
    onSelectedSessionChange?.(selectedSessionId);
  }, [onSelectedSessionChange, selectedSessionId]);

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
    setRuntimeAction("starting");
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
      setRuntimeAction(null);
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
    setRuntimeAction("stopping");
    try {
      setRuntimeState(await piNative.stop());
      setSessions((current) => markPiSessionsStopped(current));
      setDiagnostics(null);
      setDiagnosticsError(null);
    } catch (error) {
      setRuntimeState(toErrorState(error));
    } finally {
      setRuntimeAction(null);
      setIsBusy(false);
    }
  }, []);

  const requestStopRuntime = useCallback(() => {
    const hasRunningSessions = sessions.some(
      (session) => session.status === "running",
    );
    const confirmed =
      !hasRunningSessions ||
      typeof window === "undefined" ||
      window.confirm(
        "Stop Pi runtime? Active Pi responses will be interrupted and restored sessions will be marked stopped.",
      );

    if (confirmed) {
      void stopRuntime();
    }
  }, [sessions, stopRuntime]);

  const restartRuntime = useCallback(async () => {
    setIsBusy(true);
    setRuntimeAction("restarting");
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
      setRuntimeAction(null);
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
      const providerConfig = activeThinkingLevel
        ? {
            ...piProvider.config,
            thinkingLevel: activeThinkingLevel,
          }
        : piProvider.config;
      const result = await piNative.sessionCreate(
        undefined,
        workspaceRoot,
        providerConfig,
      );
      applySessionUpdate(result.session, result.events);
      await refreshStatus();
    } catch (error) {
      setRuntimeState(toErrorState(error));
    } finally {
      setIsBusy(false);
    }
  }, [
    applySessionUpdate,
    activeThinkingLevel,
    piProvider,
    refreshStatus,
    workspaceRoot,
  ]);

  const resumeSession = useCallback(
    async (sessionId: string) => {
      if (isBusy) return;
      if (!piProvider.ok) {
        setDiagnosticsError(piProvider.error);
        return;
      }

      setIsBusy(true);
      try {
        const providerConfig = activeThinkingLevel
          ? {
              ...piProvider.config,
              thinkingLevel: activeThinkingLevel,
            }
          : piProvider.config;
        const result = await piNative.sessionResume(sessionId, providerConfig);
        applySessionUpdate(result.session, result.events);
        await refreshStatus();
      } catch (error) {
        setRuntimeState(toErrorState(error));
      } finally {
        setIsBusy(false);
      }
    },
    [
      activeThinkingLevel,
      applySessionUpdate,
      isBusy,
      piProvider,
      refreshStatus,
    ],
  );

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
          { thinkingLevel: activeThinkingLevel },
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
      activeThinkingLevel,
      applySessionUpdate,
      prompt,
      promptContext,
      selectedSessionSendable,
      selectedSession,
    ],
  );

  const retryLastPrompt = useCallback(async () => {
    const text = selectedSession?.lastPrompt?.trim() ?? "";
    if (
      isBusy ||
      selectedSession === null ||
      !selectedSessionSendable ||
      text === "" ||
      text.length > MAX_PI_PROMPT_CHARS
    ) {
      return;
    }

    const lastPromptItem = [...selectedTranscript]
      .reverse()
      .find((item) => item.kind === "user" && item.text?.trim() === text);

    setIsBusy(true);
    try {
      const result = await piNative.sessionSend(
        selectedSession.id,
        text,
        lastPromptItem?.context ?? promptContext,
        { thinkingLevel: activeThinkingLevel },
      );
      applySessionUpdate(result.session, result.events);
      setPrompt("");
    } catch (error) {
      setRuntimeState(toErrorState(error));
    } finally {
      setIsBusy(false);
    }
  }, [
    activeThinkingLevel,
    applySessionUpdate,
    isBusy,
    promptContext,
    selectedSession,
    selectedSessionSendable,
    selectedTranscript,
  ]);

  const regenerateResponse = useCallback(
    async ({
      branchGroupId,
      context,
      prompt: promptText,
    }: {
      branchGroupId: string;
      context?: PiPromptContext;
      prompt: string;
    }) => {
      if (
        isBusy ||
        selectedSession === null ||
        !selectedSessionSendable ||
        promptText.trim() === "" ||
        promptText.length > MAX_PI_PROMPT_CHARS
      ) {
        return;
      }

      const branch = {
        groupId: branchGroupId,
        index: nextPiRegenerateBranchIndex(selectedTranscript, branchGroupId),
        regeneratedFromEventId: branchGroupId,
      } satisfies PiSessionBranch;

      activeRegenerateBranchesRef.current.set(selectedSession.id, branch);
      setIsBusy(true);
      try {
        const result = await piNative.sessionSend(
          selectedSession.id,
          promptText,
          context ?? promptContext,
          {
            regenerateBranchGroupId: branchGroupId,
            thinkingLevel: activeThinkingLevel,
          },
        );
        applySessionUpdate(
          result.session,
          annotatePiSessionEventsBranch(result.events, branch),
        );
      } catch (error) {
        activeRegenerateBranchesRef.current.delete(selectedSession.id);
        setRuntimeState(toErrorState(error));
      } finally {
        setIsBusy(false);
      }
    },
    [
      activeThinkingLevel,
      applySessionUpdate,
      isBusy,
      promptContext,
      selectedSession,
      selectedSessionSendable,
      selectedTranscript,
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

  const renameSession = useCallback(
    async (sessionId: string, title: string) => {
      if (isBusy) return;

      setIsBusy(true);
      try {
        const result = await piNative.sessionRename(sessionId, title);
        applySessionUpdate(result.session, result.events);
      } catch (error) {
        setRuntimeState(toErrorState(error));
      } finally {
        setIsBusy(false);
      }
    },
    [applySessionUpdate, isBusy],
  );

  const respondToToolApproval = useCallback(
    async (toolCallId: string, approved: boolean) => {
      if (isBusy || selectedSession === null) return;

      setIsBusy(true);
      try {
        const result = await piNative.sessionToolRespond(
          selectedSession.id,
          toolCallId,
          approved,
        );
        applySessionUpdate(result.session, result.events);
      } catch (error) {
        setRuntimeState(toErrorState(error));
      } finally {
        setIsBusy(false);
      }
    },
    [applySessionUpdate, isBusy, selectedSession],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (isBusy) return;

      setIsBusy(true);
      try {
        const result = await piNative.sessionDelete(sessionId);
        applySessionEvents(result.events);
        setSelectedSessionId((current) =>
          current === sessionId ? null : current,
        );
        await refreshStatus();
      } catch (error) {
        setRuntimeState(toErrorState(error));
      } finally {
        setIsBusy(false);
      }
    },
    [applySessionEvents, isBusy, refreshStatus],
  );

  const openModelSettings = useCallback(() => {
    void openSettingsWindow("models");
  }, []);

  const openLocalAgentDocs = useCallback((agent: PiLocalAgentStatus) => {
    void openUrl(agent.docsUrl);
  }, []);

  const launchLocalAgent = useCallback(
    (agent: PiLocalAgentStatus, promptText: string | null = null) => {
      const command = buildPiLocalAgentLaunchCommand(agent, promptText, {
        windowsShell: IS_WINDOWS && workspaceEnv.kind === "local",
      });
      if (!command) {
        void openUrl(agent.docsUrl);
        return;
      }
      onOpenLocalAgent?.({
        id: agent.id,
        label: agent.label,
        command,
        prompt: promptText?.trim() ? promptText.trim() : null,
      });
    },
    [onOpenLocalAgent, workspaceEnv.kind],
  );

  return (
    <aside
      aria-label="Code sessions"
      className="flex h-full min-w-0 flex-col bg-card/80 backdrop-blur [contain:layout_style]"
    >
      {hideHeader ? null : (
        <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-2">
          <div className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-foreground/5 px-2 py-1 text-[11.5px] font-medium leading-none text-foreground">
            <HugeiconsIcon
              icon={AiChat02Icon}
              size={12}
              strokeWidth={1.9}
              className="shrink-0 text-muted-foreground"
            />
            <span className="truncate">Code</span>
          </div>
          <Badge
            variant="outline"
            className="h-5 gap-1 rounded-md border-border/55 px-1.5 text-[10.5px] text-muted-foreground"
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
      )}

      <PiRuntimeCard
        isBusy={isBusy}
        runtimeAction={runtimeAction}
        runtimeState={runtimeState}
        status={status}
        onStart={() => void startRuntime()}
        onStop={requestStopRuntime}
        onRestart={() => void restartRuntime()}
      />

      <PiLocalAgentsCard
        activeAgents={localAgentActivities}
        agents={localAgents}
        collapsed={collapsedSections.localAgents}
        disabled={isBusy}
        isRefreshing={isLocalAgentsRefreshing}
        prompt={prompt}
        onCollapsedChange={(collapsed) =>
          setSectionCollapsed("localAgents", collapsed)
        }
        onInstall={openLocalAgentDocs}
        onLaunch={(agent) => launchLocalAgent(agent)}
        onLaunchWithPrompt={(agent) => launchLocalAgent(agent, prompt)}
        onRefresh={() => void refreshLocalAgents()}
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
        onRestartRuntime={() => void restartRuntime()}
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
          onDeleteSession={(sessionId) => void deleteSession(sessionId)}
          onRenameSession={(sessionId, title) =>
            void renameSession(sessionId, title)
          }
          onResumeSession={(sessionId) => void resumeSession(sessionId)}
          onSelectSession={setSelectedSessionId}
        />

        <PiTranscript
          canRegenerate={!isBusy && selectedSessionSendable}
          selectedSession={selectedSession}
          transcript={selectedTranscript}
          onOpenWorkspace={onOpenWorkspace}
          onPopOut={onPopOut}
          onRegenerate={(request) => void regenerateResponse(request)}
          onToolApproval={(toolCallId, approved) =>
            void respondToToolApproval(toolCallId, approved)
          }
          onUsePrompt={setPrompt}
        />

        <PiComposer
          availableThinkingLevels={panelState.composer.availableThinkingLevels}
          canCreateSession={canCreateSession}
          contextUsage={panelState.composer.contextUsage}
          disabled={!runtimeReady || !selectedSessionSendable || isBusy}
          isBusy={isBusy}
          prompt={prompt}
          runtimeReady={runtimeReady}
          selectedSession={selectedSession}
          thinkingLevel={activeThinkingLevel}
          onCreateSession={() => void createSession()}
          onPromptChange={setPrompt}
          onRetryLastPrompt={() => void retryLastPrompt()}
          onSendPrompt={(event) => void sendPrompt(event)}
          onStopSession={() => void stopSelectedSession()}
          onThinkingLevelChange={setThinkingLevelOverride}
        />
      </div>
    </aside>
  );
}
