import { invoke } from "@tauri-apps/api/core";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePushToTalk } from "@/modules/ai/hooks/usePushToTalk";
import { PiComposer } from "@/modules/pi/components/PiComposer";
import {
  type PendingPiDestructiveAction,
  PiDestructiveActionDialog,
} from "@/modules/pi/components/PiDestructiveActionDialog";
import { PiMcpOAuthDialog } from "@/modules/pi/components/PiMcpOAuthDialog";
import { PiPanelHeader } from "@/modules/pi/components/PiPanelHeader";
import {
  PiPanelSupportingSections,
  PiPanelSupportingSectionsProvider,
} from "@/modules/pi/components/PiPanelSupportingSections";
import {
  buildSessionKeywordIndex,
  PiSessionList,
} from "@/modules/pi/components/PiSessionList";
import { PiTranscript } from "@/modules/pi/components/PiTranscript";
import { PiUsageCard } from "@/modules/pi/components/PiUsageCard";
import type { PiLocalAgentLaunchRequest } from "@/modules/pi/lib/local-agents";
import {
  type PiPanelSectionId,
  usePiControllerState,
  usePiControllerStore,
} from "@/modules/pi/lib/PiControllerProvider";
import {
  EMPTY_CAPABILITY_AUDIT_ENTRIES,
  INITIAL_PI_STATE,
  INITIAL_SECTION_COLLAPSED,
  toErrorState,
} from "@/modules/pi/lib/panel-defaults";
import { buildPiPanelState } from "@/modules/pi/lib/panel-state";
import { getSessionBackend } from "@/modules/pi/lib/pi-session-backend";
import type {
  PiProviderRuntimeConfig,
  PiThinkingLevel,
} from "@/modules/pi/lib/provider";
import { deletePiSessionWithArtifactCleanup } from "@/modules/pi/lib/sessionLifecycle";
import type {
  PiPromptContext,
  PiQuestionAnswer,
  PiSessionBranch,
} from "@/modules/pi/lib/sessions";
import {
  annotatePiSessionEventsBranch,
  MAX_PI_PROMPT_CHARS,
  nextPiRegenerateBranchIndex,
} from "@/modules/pi/lib/sessions";
import { useMcpSurface } from "@/modules/pi/lib/useMcpSurface";
import { usePiLocalAgentLaunch } from "@/modules/pi/lib/usePiLocalAgentLaunch";
import { usePiLocalAgentsPanel } from "@/modules/pi/lib/usePiLocalAgentsPanel";
import { usePiPanelRefreshers } from "@/modules/pi/lib/usePiPanelRefreshers";
import { usePiProviderConfig } from "@/modules/pi/lib/usePiProviderConfig";
import { usePiProviderKeyStatus } from "@/modules/pi/lib/usePiProviderKeyStatus";
import { usePiRuntimeActions } from "@/modules/pi/lib/usePiRuntimeActions";
import { usePiSessionEventStream } from "@/modules/pi/lib/usePiSessionEventStream";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  SidebarPanelBody,
  SidebarPanelFrame,
  SidebarPanelScrollRegion,
} from "@/modules/sidebar";
import { useWorkspaceEnvStore } from "@/modules/workspace";

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
  surfaceLabel?: string;
  onOpenLocalAgent?: (request: PiLocalAgentLaunchRequest) => void;
  onOpenWorkspace?: () => void;
  onPopOut?: () => void;
  onSelectedSessionChange?: (sessionId: string | null) => void;
};

function piProviderConfigWithThinkingLevel(
  config: PiProviderRuntimeConfig,
  thinkingLevel: PiThinkingLevel | null,
): PiProviderRuntimeConfig {
  return thinkingLevel ? { ...config, thinkingLevel } : config;
}

export function PiPanel({
  workspaceRoot = null,
  activeCwd = null,
  activeFile = null,
  activeTerminalPrivate = false,
  focusRequest = null,
  hideHeader = false,
  surfaceLabel = "Code",
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
  const [workflowAuditEntries, setWorkflowAuditEntries] = usePiControllerState(
    "workflowAuditEntries",
    EMPTY_CAPABILITY_AUDIT_ENTRIES,
  );
  const [appAuditEntries, setAppAuditEntries] = usePiControllerState(
    "appAuditEntries",
    EMPTY_CAPABILITY_AUDIT_ENTRIES,
  );
  const [capabilityAuditFilter, setCapabilityAuditFilter] =
    usePiControllerState("capabilityAuditFilter", "all");
  const [capabilityAuditExpandedKeys, setCapabilityAuditExpandedKeys] =
    usePiControllerState("capabilityAuditExpandedKeys", []);
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
  const sessionKeywords = useMemo(
    () => buildSessionKeywordIndex(sessionEvents),
    [sessionEvents],
  );
  const [selectedSessionId, setSelectedSessionId] = usePiControllerState(
    "selectedSessionId",
    null,
  );
  const [prompt, setPrompt] = usePiControllerState("prompt", "");
  const [thinkingLevelOverride, setThinkingLevelOverride] =
    usePiControllerState("thinkingLevelOverride", null);
  const [isBusy, setIsBusy] = useState(false);
  const [collapsedSections, setCollapsedSections] = usePiControllerState(
    "collapsedSections",
    INITIAL_SECTION_COLLAPSED,
  );
  const [supportingSectionsHidden, setSupportingSectionsHidden] =
    usePiControllerState("supportingSectionsHidden", false);
  const activeRegenerateBranchesRef = useRef(
    piControllerStore.regenerateBranches,
  );
  const prewarmAttemptedRef = useRef(piControllerStore.getPrewarmAttempted());

  useEffect(() => {
    return () => {
      piControllerStore.setPrewarmAttempted(prewarmAttemptedRef.current);
    };
  }, [piControllerStore]);

  const workspaceEnv = useWorkspaceEnvStore((state) => state.env);
  const { result: piProvider, thinkingScope } = usePiProviderConfig();
  const providerKeyStatus = usePiProviderKeyStatus(piProvider);

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
  const capabilityAuditEntries = useMemo(
    () => [
      ...(diagnostics?.capabilityAudit ?? []),
      ...workflowAuditEntries,
      ...appAuditEntries,
    ],
    [appAuditEntries, diagnostics?.capabilityAudit, workflowAuditEntries],
  );
  const activeThinkingLevel = panelState.composer.thinkingLevel;
  const {
    isLocalAgentsRefreshing,
    localAgentActivities,
    localAgents,
    refreshLocalAgents,
  } = usePiLocalAgentsPanel();

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
  const supportingSectionsToggleLabel = supportingSectionsHidden
    ? `Show ${surfaceLabel} sidebar sections`
    : `Show only ${surfaceLabel} chat`;

  const {
    refreshDiagnostics,
    refreshHistory,
    refreshPanelDiagnostics,
    refreshSessions,
    refreshStatus,
  } = usePiPanelRefreshers({
    setAppAuditEntries,
    setDiagnostics,
    setDiagnosticsError,
    setHistoryError,
    setIsDiagnosticsRefreshing,
    setRuntimeState,
    setSessionEvents,
    setSessions,
    setWorkflowAuditEntries,
  });

  const { applySessionEvents, applySessionUpdate } = usePiSessionEventStream({
    activeRegenerateBranchesRef,
    refreshDiagnostics,
    setSelectedSessionId,
    setSessionEvents,
    setSessions,
  });

  const [pendingDestructiveAction, setPendingDestructiveAction] =
    useState<PendingPiDestructiveAction | null>(null);
  const requestRemoveMcpConfigConfirmation = useCallback(
    (serverId: string) =>
      setPendingDestructiveAction({ kind: "mcp-config", serverId }),
    [],
  );
  const requestStopRuntimeConfirmation = useCallback(
    () => setPendingDestructiveAction({ kind: "stop-runtime" }),
    [],
  );

  const {
    busyServerId: mcpBusyServerId,
    cancelOAuthDialog: cancelMcpOAuthDialog,
    configs: mcpConfigs,
    connect: connectMcpServer,
    disconnect: disconnectMcpServer,
    envSecretStatuses: mcpEnvSecretStatuses,
    error: mcpError,
    isRefreshing: isMcpRefreshing,
    oauthDialog: mcpOAuthDialog,
    refresh: refreshMcpSurface,
    removeConfig: removeMcpConfig,
    removeConfigNow: removeMcpConfigNow,
    removeEnvSecret: removeMcpEnvSecret,
    reopenOAuthAuthorization: reopenMcpOAuthAuthorization,
    restart: restartMcpServer,
    saveConfig: saveMcpConfig,
    setEnvSecret: setMcpEnvSecret,
    setOAuthCodeOrRedirectUrl: setMcpOAuthCodeOrRedirectUrl,
    setToolPolicy: setMcpToolPolicy,
    startOAuth: authorizeMcpServerWithOAuth,
    statuses: mcpStatuses,
    submitOAuthDialog: submitMcpOAuthDialog,
    tools: mcpTools,
  } = useMcpSurface({
    onRemoveConfigNeedsConfirmation: requestRemoveMcpConfigConfirmation,
    refreshDiagnostics,
  });

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

  const onSelectedSessionChangeRef = useRef(onSelectedSessionChange);
  useEffect(() => {
    onSelectedSessionChangeRef.current = onSelectedSessionChange;
  }, [onSelectedSessionChange]);
  useEffect(() => {
    onSelectedSessionChangeRef.current?.(selectedSessionId);
  }, [selectedSessionId]);

  const {
    requestStopRuntime,
    restartRuntime,
    runtimeAction,
    startRuntime,
    stopRuntime,
  } = usePiRuntimeActions({
    isBusy,
    onStopRuntimeNeedsConfirmation: requestStopRuntimeConfirmation,
    prewarmAttemptedRef,
    refreshDiagnostics,
    refreshHistory,
    refreshSessions,
    runtimeState,
    sessions,
    setDiagnostics,
    setDiagnosticsError,
    setIsBusy,
    setRuntimeState,
    setSessions,
  });

  const pendingMcpConfig =
    pendingDestructiveAction?.kind === "mcp-config"
      ? mcpConfigs.find(
          (config) => config.id === pendingDestructiveAction.serverId,
        )
      : null;
  const confirmPendingDestructiveAction = () => {
    const action = pendingDestructiveAction;
    setPendingDestructiveAction(null);
    if (!action) return;
    if (action.kind === "stop-runtime") {
      void stopRuntime();
    } else if (action.kind === "rollback") {
      void runPiPanelAction(async () => {
        const result = await getSessionBackend().sessionRollback(
          action.sessionId,
          action.eventId,
        );
        applySessionUpdate(result.session, []);
      });
    } else {
      void removeMcpConfigNow(action.serverId);
    }
  };

  const runPiPanelAction = useCallback(
    async (
      action: () => Promise<void>,
      onError: (error: unknown) => void = (error) =>
        setRuntimeState(toErrorState(error)),
    ) => {
      setIsBusy(true);
      try {
        await action();
      } catch (error) {
        onError(error);
      } finally {
        setIsBusy(false);
      }
    },
    [setRuntimeState],
  );

  const createSession = useCallback(async () => {
    if (!piProvider.ok) {
      setDiagnosticsError(piProvider.error);
      return;
    }
    if (!canCreateSession || workspaceRoot === null) {
      return;
    }

    await runPiPanelAction(async () => {
      const providerConfig = piProviderConfigWithThinkingLevel(
        piProvider.config,
        activeThinkingLevel,
      );
      const result = await getSessionBackend().sessionCreate(
        undefined,
        workspaceRoot,
        providerConfig,
      );
      applySessionUpdate(result.session, result.events);
      await refreshStatus();
    });
  }, [
    applySessionUpdate,
    activeThinkingLevel,
    canCreateSession,
    piProvider,
    refreshStatus,
    runPiPanelAction,
    workspaceRoot,
  ]);

  const resumeSession = useCallback(
    async (sessionId: string) => {
      if (isBusy) return;
      if (!piProvider.ok) {
        setDiagnosticsError(piProvider.error);
        return;
      }

      await runPiPanelAction(
        async () => {
          const providerConfig = piProviderConfigWithThinkingLevel(
            piProvider.config,
            activeThinkingLevel,
          );
          const result = await getSessionBackend().sessionResume(
            sessionId,
            providerConfig,
          );
          applySessionUpdate(result.session, result.events);
          await refreshStatus();
        },
        (error) => {
          setSessions((current) =>
            current.map((session) =>
              session.id === sessionId
                ? { ...session, sdkSessionFile: null }
                : session,
            ),
          );
          setRuntimeState(toErrorState(error));
        },
      );
    },
    [
      activeThinkingLevel,
      applySessionUpdate,
      isBusy,
      piProvider,
      refreshStatus,
      runPiPanelAction,
      setRuntimeState,
      setSessions,
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

      await runPiPanelAction(async () => {
        const result = await getSessionBackend().sessionSend(
          selectedSession.id,
          text,
          promptContext,
          { thinkingLevel: activeThinkingLevel },
        );
        applySessionUpdate(result.session, result.events);
        setPrompt("");
      });
    },
    [
      activeThinkingLevel,
      applySessionUpdate,
      prompt,
      promptContext,
      runPiPanelAction,
      selectedSessionSendable,
      selectedSession,
      setPrompt,
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

    await runPiPanelAction(async () => {
      const result = await getSessionBackend().sessionSend(
        selectedSession.id,
        text,
        lastPromptItem?.context ?? promptContext,
        { thinkingLevel: activeThinkingLevel },
      );
      applySessionUpdate(result.session, result.events);
      setPrompt("");
    });
  }, [
    activeThinkingLevel,
    applySessionUpdate,
    isBusy,
    promptContext,
    runPiPanelAction,
    selectedSession,
    selectedSessionSendable,
    selectedTranscript,
    setPrompt,
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
      await runPiPanelAction(
        async () => {
          const result = await getSessionBackend().sessionSend(
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
        },
        (error) => {
          activeRegenerateBranchesRef.current.delete(selectedSession.id);
          setRuntimeState(toErrorState(error));
        },
      );
    },
    [
      activeThinkingLevel,
      applySessionUpdate,
      isBusy,
      promptContext,
      runPiPanelAction,
      selectedSession,
      selectedSessionSendable,
      selectedTranscript,
      setRuntimeState,
    ],
  );

  const stopSelectedSession = useCallback(async () => {
    if (selectedSession === null) {
      return;
    }

    await runPiPanelAction(async () => {
      const result = await getSessionBackend().sessionStop(selectedSession.id);
      applySessionUpdate(result.session, result.events);
    });
  }, [applySessionUpdate, runPiPanelAction, selectedSession]);

  const renameSession = useCallback(
    async (sessionId: string, title: string) => {
      if (isBusy) return;

      await runPiPanelAction(async () => {
        const result = await getSessionBackend().sessionRename(
          sessionId,
          title,
        );
        applySessionUpdate(result.session, result.events);
      });
    },
    [applySessionUpdate, isBusy, runPiPanelAction],
  );

  const archiveSession = useCallback(
    async (sessionId: string) => {
      if (isBusy) return;

      await runPiPanelAction(async () => {
        const result = await getSessionBackend().sessionArchive(sessionId);
        applySessionUpdate(result.session, []);
      });
    },
    [applySessionUpdate, isBusy, runPiPanelAction],
  );

  const restoreSession = useCallback(
    async (sessionId: string) => {
      if (isBusy) return;

      await runPiPanelAction(async () => {
        const result = await getSessionBackend().sessionRestore(sessionId);
        applySessionUpdate(result.session, []);
      });
    },
    [applySessionUpdate, isBusy, runPiPanelAction],
  );

  const forkFromTurn = useCallback(
    async (eventId: string) => {
      if (isBusy || selectedSession === null) return;

      await runPiPanelAction(async () => {
        const result = await getSessionBackend().sessionFork(
          selectedSession.id,
          eventId,
        );
        applySessionUpdate(result.session, result.events);
        setSelectedSessionId(result.session.id);
      });
    },
    [
      applySessionUpdate,
      isBusy,
      runPiPanelAction,
      selectedSession,
      setSelectedSessionId,
    ],
  );

  const rollbackToTurn = useCallback(
    (eventId: string) => {
      if (isBusy || selectedSession === null) return;
      // Count events after the rollback point from transcript items
      const rollbackIdx = selectedTranscript.findIndex((item) =>
        item.eventIds.includes(eventId),
      );
      const eventsAfter =
        rollbackIdx >= 0
          ? selectedTranscript
              .slice(rollbackIdx + 1)
              .reduce((sum, item) => sum + item.eventIds.length, 0)
          : 0;
      setPendingDestructiveAction({
        kind: "rollback",
        sessionId: selectedSession.id,
        eventId,
        eventCount: eventsAfter,
      });
    },
    [isBusy, selectedSession, selectedTranscript],
  );

  // Tool approvals and question answers are how the user UNBLOCKS an in-flight
  // agent turn, so they happen precisely while a send is still streaming
  // (isBusy === true). They must NOT be gated on isBusy, and must NOT go through
  // runPiPanelAction — doing so would clear the busy state owned by the active
  // send and re-enable the whole panel mid-run. They do their own error
  // handling instead.
  const respondToToolApproval = useCallback(
    async (toolCallId: string, approved: boolean) => {
      if (selectedSession === null) return;
      try {
        const result = await getSessionBackend().sessionToolRespond(
          selectedSession.id,
          toolCallId,
          approved,
        );
        applySessionUpdate(result.session, result.events);
      } catch (error) {
        setRuntimeState(toErrorState(error));
      }
    },
    [applySessionUpdate, selectedSession, setRuntimeState],
  );

  const respondToQuestion = useCallback(
    async (questionId: string, answers: PiQuestionAnswer[]) => {
      if (selectedSession === null) return;
      try {
        const result = await getSessionBackend().sessionQuestionRespond(
          selectedSession.id,
          questionId,
          answers,
        );
        applySessionUpdate(result.session, result.events);
      } catch (error) {
        setRuntimeState(toErrorState(error));
      }
    },
    [applySessionUpdate, selectedSession, setRuntimeState],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (isBusy) return;

      await runPiPanelAction(async () => {
        const result = await deletePiSessionWithArtifactCleanup({ sessionId });
        applySessionEvents(result.sessionDelete.events);
        setSelectedSessionId((current) =>
          current === sessionId ? null : current,
        );
        if (result.artifactCleanupError) {
          setRuntimeState(
            toErrorState(
              new Error(
                `Pi session deleted, but artifact cleanup failed: ${result.artifactCleanupError}`,
              ),
            ),
          );
          return;
        }
        await refreshStatus();
      });
    },
    [
      applySessionEvents,
      isBusy,
      refreshStatus,
      runPiPanelAction,
      setRuntimeState,
      setSelectedSessionId,
    ],
  );

  const openModelSettings = useCallback(() => {
    void openSettingsWindow("models");
  }, []);

  const { launchLocalAgent, launchLocalAgentWithPrompt, openLocalAgentDocs } =
    usePiLocalAgentLaunch({ onOpenLocalAgent, prompt, workspaceEnv });

  const pushToTalkShortcut = usePreferencesStore((s) => s.pushToTalkShortcut);
  const pttMediaRef = useRef<MediaRecorder | null>(null);
  const pttChunksRef = useRef<Blob[]>([]);
  const pttCancelledRef = useRef(false);
  const pttGenRef = useRef(0);
  usePushToTalk({
    enabled: true,
    shortcut: pushToTalkShortcut,
    onStart: () => {
      if (selectedSession === null || !selectedSessionSendable) return;
      pttCancelledRef.current = false;
      pttChunksRef.current = [];
      // Per-activation token: if a newer press/release happens while
      // getUserMedia is still resolving, the stale stream is dropped instead of
      // overwriting (and leaking) the active recorder.
      const gen = ++pttGenRef.current;
      if (typeof MediaRecorder === "undefined") return;
      navigator.mediaDevices
        ?.getUserMedia({ audio: true })
        .then((stream) => {
          if (pttCancelledRef.current || gen !== pttGenRef.current) {
            stream.getTracks().forEach((t) => {
              t.stop();
            });
            return;
          }
          const rec = new MediaRecorder(stream);
          rec.ondataavailable = (e) => {
            if (e.data.size > 0) pttChunksRef.current.push(e.data);
          };
          rec.start();
          pttMediaRef.current = rec;
        })
        .catch(() => {});
    },
    onStop: () => {
      pttCancelledRef.current = true;
      const rec = pttMediaRef.current;
      if (!rec) return;
      rec.onstop = () => {
        const blob = new Blob(pttChunksRef.current, {
          type: rec.mimeType || "audio/webm",
        });
        blob.arrayBuffer().then((buf) => {
          invoke<{ text: string }>("transcribe_audio", {
            audioData: Array.from(new Uint8Array(buf)),
            mimeType: blob.type,
            provider: "deepgram",
          })
            .then((r) => {
              if (r.text.trim()) setPrompt(r.text.trim());
            })
            .catch(() => {});
        });
        rec.stream.getTracks().forEach((t) => {
          t.stop();
        });
        pttMediaRef.current = null;
      };
      rec.stop();
    },
  });

  useEffect(() => {
    return () => {
      pttCancelledRef.current = true;
      const rec = pttMediaRef.current;
      if (rec && rec.state !== "inactive") {
        rec.stream.getTracks().forEach((t) => {
          t.stop();
        });
        rec.stop();
        pttMediaRef.current = null;
      }
    };
  }, []);

  return (
    <>
      <SidebarPanelFrame aria-label={`${surfaceLabel} sessions`}>
        {hideHeader ? null : (
          <PiPanelHeader
            status={status}
            supportingSectionsHidden={supportingSectionsHidden}
            supportingSectionsToggleLabel={supportingSectionsToggleLabel}
            surfaceLabel={surfaceLabel}
            onSupportingSectionsHiddenChange={setSupportingSectionsHidden}
          />
        )}

        {!supportingSectionsHidden ? (
          <SidebarPanelScrollRegion
            role="region"
            aria-label={`${surfaceLabel} controls`}
            className="max-h-[min(55%,32rem)] shrink-0 border-b border-border/35 bg-card/30"
          >
            <PiPanelSupportingSectionsProvider
              state={{
                runtimeCard: {
                  isBusy,
                  runtimeAction,
                  runtimeState,
                  status,
                  onStart: () => void startRuntime(),
                  onStop: requestStopRuntime,
                  onRestart: () => void restartRuntime(),
                },
                localAgentsCard: {
                  activeAgents: localAgentActivities,
                  agents: localAgents,
                  collapsed: collapsedSections.localAgents,
                  disabled: isBusy,
                  refreshing: isLocalAgentsRefreshing,
                  prompt,
                  onCollapsedChange: (collapsed) =>
                    setSectionCollapsed("localAgents", collapsed),
                  onInstall: openLocalAgentDocs,
                  onLaunch: launchLocalAgent,
                  onLaunchWithPrompt: launchLocalAgentWithPrompt,
                  onRefresh: () => void refreshLocalAgents(),
                },
                diagnosticsCard: {
                  collapsed: collapsedSections.diagnostics,
                  disabled: isBusy || isDiagnosticsRefreshing,
                  refreshing: isDiagnosticsRefreshing,
                  view: diagnosticsView,
                  onCollapsedChange: (collapsed) =>
                    setSectionCollapsed("diagnostics", collapsed),
                  onOpenSettings: openModelSettings,
                  onRefresh: () => void refreshPanelDiagnostics(),
                  onRestartRuntime: () => void restartRuntime(),
                  onStartRuntime: () => void startRuntime(),
                },
                capabilityAuditCard: {
                  collapsed: collapsedSections.capabilityAudit ?? true,
                  disabled: isBusy || isDiagnosticsRefreshing,
                  entries: capabilityAuditEntries,
                  expandedEntryKeys: capabilityAuditExpandedKeys,
                  filter: capabilityAuditFilter,
                  onCollapsedChange: (collapsed) =>
                    setSectionCollapsed("capabilityAudit", collapsed),
                  onExpandedEntryKeysChange: setCapabilityAuditExpandedKeys,
                  onFilterChange: setCapabilityAuditFilter,
                },
                mcpCard: {
                  auditEntries: capabilityAuditEntries,
                  collapsed: collapsedSections.mcp ?? true,
                  configs: mcpConfigs,
                  disabled:
                    isBusy || isMcpRefreshing || mcpBusyServerId !== null,
                  envSecretStatuses: mcpEnvSecretStatuses,
                  error: mcpError,
                  refreshing: isMcpRefreshing,
                  statuses: mcpStatuses,
                  tools: mcpTools,
                  onCollapsedChange: (collapsed) =>
                    setSectionCollapsed("mcp", collapsed),
                  onConnect: (server) => void connectMcpServer(server),
                  onDisconnect: (serverId) =>
                    void disconnectMcpServer(serverId),
                  onEnvSecretRemove: (serverId, name) =>
                    void removeMcpEnvSecret(serverId, name),
                  onEnvSecretSet: (serverId, name, value) =>
                    void setMcpEnvSecret(serverId, name, value),
                  onRefresh: () => void refreshMcpSurface(),
                  onRemoveConfig: (serverId) => void removeMcpConfig(serverId),
                  onRestart: (server) => void restartMcpServer(server),
                  onSaveConfig: (config) => void saveMcpConfig(config),
                  onStartOAuth: (server) =>
                    void authorizeMcpServerWithOAuth(server),
                  onToolPolicyChange: (qualifiedName, approvalPolicy) =>
                    void setMcpToolPolicy(qualifiedName, approvalPolicy),
                },
                contextBar: {
                  collapsed: collapsedSections.context,
                  items: contextPreview,
                  onCollapsedChange: (collapsed) =>
                    setSectionCollapsed("context", collapsed),
                },
              }}
            >
              <PiPanelSupportingSections />
            </PiPanelSupportingSectionsProvider>
          </SidebarPanelScrollRegion>
        ) : null}

        <SidebarPanelBody>
          {supportingSectionsHidden ? null : (
            <>
              <PiSessionList
                collapsed={collapsedSections.sessions}
                disabled={isBusy}
                status={
                  !runtimeReady
                    ? { phase: "offline" }
                    : { phase: "ready", canCreateSession }
                }
                selectedSessionId={selectedSessionId}
                sessions={sessions}
                sessionKeywords={sessionKeywords}
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
                onArchiveSession={(sessionId) => void archiveSession(sessionId)}
                onRestoreSession={(sessionId) => void restoreSession(sessionId)}
                onSelectSession={setSelectedSessionId}
              />
              <PiUsageCard
                sessionId={selectedSessionId}
                collapsed={collapsedSections.usage ?? true}
                disabled={isBusy}
                onCollapsedChange={(collapsed) =>
                  setSectionCollapsed("usage", collapsed)
                }
              />
            </>
          )}

          <PiTranscript
            canRegenerate={!isBusy && selectedSessionSendable}
            selectedSession={selectedSession}
            transcript={selectedTranscript}
            onOpenWorkspace={onOpenWorkspace}
            onPopOut={onPopOut}
            onRegenerate={(request) => void regenerateResponse(request)}
            onForkFromTurn={(eventId) => void forkFromTurn(eventId)}
            onRollbackToTurn={(eventId) => void rollbackToTurn(eventId)}
            onToolApproval={(toolCallId, approved) =>
              void respondToToolApproval(toolCallId, approved)
            }
            onQuestionRespond={(questionId, answers) =>
              void respondToQuestion(questionId, answers)
            }
            onUsePrompt={setPrompt}
          />

          <PiComposer
            availableThinkingLevels={
              panelState.composer.availableThinkingLevels
            }
            contextUsage={panelState.composer.contextUsage}
            prompt={prompt}
            selectedSession={selectedSession}
            status={
              !runtimeReady
                ? { phase: "offline" }
                : isBusy
                  ? { phase: "busy" }
                  : { phase: "active", canCreateSession }
            }
            thinkingLevel={activeThinkingLevel}
            onCreateSession={() => void createSession()}
            onPromptChange={setPrompt}
            onRetryLastPrompt={() => void retryLastPrompt()}
            onSendPrompt={(event) => void sendPrompt(event)}
            onStopSession={() => void stopSelectedSession()}
            onThinkingLevelChange={setThinkingLevelOverride}
          />
        </SidebarPanelBody>
      </SidebarPanelFrame>

      <PiMcpOAuthDialog
        dialog={mcpOAuthDialog}
        onCancel={cancelMcpOAuthDialog}
        onCodeOrRedirectUrlChange={setMcpOAuthCodeOrRedirectUrl}
        onReopenAuthorization={() => void reopenMcpOAuthAuthorization()}
        onSubmit={submitMcpOAuthDialog}
      />
      <PiDestructiveActionDialog
        action={pendingDestructiveAction}
        mcpConfigName={pendingMcpConfig?.name ?? null}
        onCancel={() => setPendingDestructiveAction(null)}
        onConfirm={confirmPendingDestructiveAction}
      />
    </>
  );
}
