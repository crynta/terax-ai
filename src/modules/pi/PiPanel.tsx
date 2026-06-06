import { listen } from "@tauri-apps/api/event";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PiComposer } from "@/modules/pi/components/PiComposer";
import { PiMcpOAuthDialog } from "@/modules/pi/components/PiMcpOAuthDialog";
import { PiPanelHeader } from "@/modules/pi/components/PiPanelHeader";
import { PiPanelSupportingSections } from "@/modules/pi/components/PiPanelSupportingSections";
import { PiSessionList } from "@/modules/pi/components/PiSessionList";
import { PiTranscript } from "@/modules/pi/components/PiTranscript";
import type { PiLocalAgentLaunchRequest } from "@/modules/pi/lib/local-agents";
import { piNative } from "@/modules/pi/lib/native";

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
import { usePiProviderConfig } from "@/modules/pi/lib/usePiProviderConfig";
import { usePiProviderKeyStatus } from "@/modules/pi/lib/usePiProviderKeyStatus";
import { usePiRuntimeActions } from "@/modules/pi/lib/usePiRuntimeActions";
import { usePiLocalAgentLaunch } from "@/modules/pi/lib/usePiLocalAgentLaunch";
import { usePiPanelRefreshers } from "@/modules/pi/lib/usePiPanelRefreshers";
import { deletePiSessionWithArtifactCleanup } from "@/modules/pi/lib/sessionLifecycle";
import { useMcpSurface } from "@/modules/pi/lib/useMcpSurface";
import { usePiLocalAgentsPanel } from "@/modules/pi/lib/usePiLocalAgentsPanel";
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
  isKnownPiSessionEvent,
  MAX_PI_PROMPT_CHARS,
  PI_SESSION_EVENT,
  mergePiSessionEvents,
  nextPiRegenerateBranchIndex,
  upsertPiSession,
} from "@/modules/pi/lib/sessions";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
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
        event.type === PI_SESSION_EVENT.Deleted ||
        event.type === PI_SESSION_EVENT.Error ||
        event.type === PI_SESSION_EVENT.OutputText ||
        (isKnownPiSessionEvent(event, PI_SESSION_EVENT.Status) &&
          event.payload.status !== "running")
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
  } = useMcpSurface({ refreshDiagnostics });

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

  const { requestStopRuntime, restartRuntime, runtimeAction, startRuntime } =
    usePiRuntimeActions({
      isBusy,
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
        setSessions((current) =>
          current.map((session) =>
            session.id === sessionId
              ? { ...session, sdkSessionFile: null }
              : session,
          ),
        );
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

  const {
    launchLocalAgent,
    launchLocalAgentWithPrompt,
    openLocalAgentDocs,
  } = usePiLocalAgentLaunch({ onOpenLocalAgent, prompt, workspaceEnv });

  return (
    <>
      <aside
        aria-label={`${surfaceLabel} sessions`}
        className="flex h-full min-w-0 flex-col bg-card/80 backdrop-blur [contain:layout_style]"
      >
        {hideHeader ? null : (
          <PiPanelHeader
            status={status}
            supportingSectionsHidden={supportingSectionsHidden}
            supportingSectionsToggleLabel={supportingSectionsToggleLabel}
            surfaceLabel={surfaceLabel}
            onSupportingSectionsHiddenChange={setSupportingSectionsHidden}
          />
        )}

        <PiPanelSupportingSections
          hidden={supportingSectionsHidden}
          runtimeCard={{
            isBusy,
            runtimeAction,
            runtimeState,
            status,
            onStart: () => void startRuntime(),
            onStop: requestStopRuntime,
            onRestart: () => void restartRuntime(),
          }}
          localAgentsCard={{
            activeAgents: localAgentActivities,
            agents: localAgents,
            collapsed: collapsedSections.localAgents,
            disabled: isBusy,
            isRefreshing: isLocalAgentsRefreshing,
            prompt,
            onCollapsedChange: (collapsed) =>
              setSectionCollapsed("localAgents", collapsed),
            onInstall: openLocalAgentDocs,
            onLaunch: launchLocalAgent,
            onLaunchWithPrompt: launchLocalAgentWithPrompt,
            onRefresh: () => void refreshLocalAgents(),
          }}
          diagnosticsCard={{
            collapsed: collapsedSections.diagnostics,
            disabled: isBusy || isDiagnosticsRefreshing,
            isRefreshing: isDiagnosticsRefreshing,
            view: diagnosticsView,
            onCollapsedChange: (collapsed) =>
              setSectionCollapsed("diagnostics", collapsed),
            onOpenSettings: openModelSettings,
            onRefresh: () => void refreshPanelDiagnostics(),
            onRestartRuntime: () => void restartRuntime(),
            onStartRuntime: () => void startRuntime(),
          }}
          capabilityAuditCard={{
            collapsed: collapsedSections.capabilityAudit ?? true,
            disabled: isBusy || isDiagnosticsRefreshing,
            entries: capabilityAuditEntries,
            expandedEntryKeys: capabilityAuditExpandedKeys,
            filter: capabilityAuditFilter,
            onCollapsedChange: (collapsed) =>
              setSectionCollapsed("capabilityAudit", collapsed),
            onExpandedEntryKeysChange: setCapabilityAuditExpandedKeys,
            onFilterChange: setCapabilityAuditFilter,
          }}
          mcpCard={{
            auditEntries: capabilityAuditEntries,
            collapsed: collapsedSections.mcp ?? true,
            configs: mcpConfigs,
            disabled: isBusy || isMcpRefreshing || mcpBusyServerId !== null,
            envSecretStatuses: mcpEnvSecretStatuses,
            error: mcpError,
            isRefreshing: isMcpRefreshing,
            statuses: mcpStatuses,
            tools: mcpTools,
            onCollapsedChange: (collapsed) =>
              setSectionCollapsed("mcp", collapsed),
            onConnect: (server) => void connectMcpServer(server),
            onDisconnect: (serverId) => void disconnectMcpServer(serverId),
            onEnvSecretRemove: (serverId, name) =>
              void removeMcpEnvSecret(serverId, name),
            onEnvSecretSet: (serverId, name, value) =>
              void setMcpEnvSecret(serverId, name, value),
            onRefresh: () => void refreshMcpSurface(),
            onRemoveConfig: (serverId) => void removeMcpConfig(serverId),
            onRestart: (server) => void restartMcpServer(server),
            onSaveConfig: (config) => void saveMcpConfig(config),
            onStartOAuth: (server) => void authorizeMcpServerWithOAuth(server),
            onToolPolicyChange: (qualifiedName, approvalPolicy) =>
              void setMcpToolPolicy(qualifiedName, approvalPolicy),
          }}
          contextBar={{
            collapsed: collapsedSections.context,
            items: contextPreview,
            onCollapsedChange: (collapsed) =>
              setSectionCollapsed("context", collapsed),
          }}
        />

        <div className="flex min-h-0 flex-1 flex-col">
          {supportingSectionsHidden ? null : (
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
          )}

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
            availableThinkingLevels={
              panelState.composer.availableThinkingLevels
            }
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

      <PiMcpOAuthDialog
        dialog={mcpOAuthDialog}
        onCancel={cancelMcpOAuthDialog}
        onCodeOrRedirectUrlChange={setMcpOAuthCodeOrRedirectUrl}
        onReopenAuthorization={() => void reopenMcpOAuthAuthorization()}
        onSubmit={submitMcpOAuthDialog}
      />
    </>
  );
}
