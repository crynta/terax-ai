import { getModelContextLimit } from "@/modules/ai/config";
import {
  type PiProviderResolution,
  type PiThinkingLevel,
  piThinkingLevelsForProvider,
} from "@/modules/pi/lib/provider";
import type {
  PiPromptContext,
  PiSession,
  PiSessionEvent,
  PiTranscriptItem,
} from "@/modules/pi/lib/sessions";
import {
  buildPiSessionTranscript,
  isPiSessionSendable,
  MAX_PI_PROMPT_CHARS,
} from "@/modules/pi/lib/sessions";
import type { PiDiagnostics, PiRuntimeState } from "@/modules/pi/lib/status";
import { getPiStatusView, type PiStatusView } from "@/modules/pi/lib/status";
import {
  buildPiContextPreview,
  type PiContextPreviewItem,
} from "@/modules/pi/lib/view";
import {
  buildPiDiagnosticsView,
  type PiDiagnosticsView,
  type PiProviderKeyStatus,
} from "./diagnostics";

export type PiComposerQueuedPrompt = {
  id: string;
  mode: "follow-up" | "steer";
  queueIndex: number;
  text: string;
};

export type PiComposerContextUsage = {
  tokens: number | null;
  contextWindow: number | null;
  percent: number | null;
};

export type PiComposerSelectedModel = {
  providerLabel: string;
  modelLabel: string;
};

export type PiComposerState = {
  availableThinkingLevels: PiThinkingLevel[];
  canCreateSession: boolean;
  canSend: boolean;
  canStop: boolean;
  contextUsage: PiComposerContextUsage | null;
  disabled: boolean;
  hint: string;
  prompt: string;
  queuedPrompts: PiComposerQueuedPrompt[];
  running: boolean;
  selectedModel: PiComposerSelectedModel | null;
  sendDisabledReason: string | null;
  thinkingLevel: PiThinkingLevel | null;
};

export type PiPanelState = {
  composer: PiComposerState;
  context: {
    preview: PiContextPreviewItem[];
    prompt: PiPromptContext;
  };
  diagnostics: {
    view: PiDiagnosticsView;
  };
  runtime: {
    ready: boolean;
    state: PiRuntimeState;
    status: PiStatusView;
  };
  sessions: {
    all: PiSession[];
    selected: PiSession | null;
    selectedEvents: PiSessionEvent[];
    selectedSendable: boolean;
    transcript: PiTranscriptItem[];
  };
};

type BuildPiPanelStateInput = {
  activeCwd: string | null;
  activeFile: string | null;
  activeTerminalPrivate: boolean;
  diagnostics: PiDiagnostics | null;
  diagnosticsError: string | null;
  historyError: string | null;
  isBusy: boolean;
  prompt: string;
  provider: PiProviderResolution;
  providerKeyStatus?: PiProviderKeyStatus;
  runtimeState: PiRuntimeState;
  selectedSessionId: string | null;
  sessionEvents: PiSessionEvent[];
  sessions: PiSession[];
  thinkingLevel?: PiThinkingLevel | null;
  workspaceRoot: string | null;
};

function composerHint(input: {
  prompt: string;
  runtimeReady: boolean;
  selectedSession: PiSession | null;
  selectedSessionSendable: boolean;
}): string {
  if (!input.runtimeReady) return "Start Pi to send prompts.";
  if (input.selectedSession === null) return "Create or select a session.";
  if (input.selectedSession.status === "running") {
    return "Pi is responding. Stop it before sending another prompt.";
  }
  if (input.selectedSession.status === "stopped") {
    return input.selectedSession.sdkSessionFile
      ? "Resume this session to send more prompts."
      : "Continue in a new session to send more prompts.";
  }
  if (input.selectedSession.status === "error") {
    return "Fix settings if needed, then send again to retry.";
  }
  if (input.prompt.length > MAX_PI_PROMPT_CHARS) {
    return `Prompt is over ${MAX_PI_PROMPT_CHARS.toLocaleString()} characters.`;
  }
  if (!input.selectedSessionSendable) return "Create or select a session.";
  return "Enter to send · Shift Enter for newline";
}

function sendDisabledReason(input: {
  isBusy: boolean;
  prompt: string;
  runtimeReady: boolean;
  selectedSession: PiSession | null;
  selectedSessionSendable: boolean;
}): string | null {
  if (input.isBusy) return "Pi is busy.";
  const hint = composerHint(input);
  if (!input.runtimeReady) return hint;
  if (input.selectedSession === null) return hint;
  if (!input.selectedSessionSendable) return hint;
  if (input.prompt.trim() === "") return "Enter a prompt to send.";
  if (input.prompt.length > MAX_PI_PROMPT_CHARS) return hint;
  return null;
}

function selectedModel(
  provider: PiProviderResolution,
): PiComposerSelectedModel | null {
  if (!provider.ok) return null;
  return {
    providerLabel: provider.providerLabel,
    modelLabel: provider.modelLabel,
  };
}

function estimateContextTokens(
  values: Array<string | null | undefined>,
): number {
  const characters = values
    .filter((value): value is string => value !== null && value !== undefined)
    .join("\n").length;
  if (characters === 0) return 0;
  return Math.max(1, Math.ceil(characters / 4));
}

function valueText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function contextValues(context: PiPromptContext | null | undefined): string[] {
  if (!context) return [];
  return [
    context.workspaceRoot ?? null,
    context.activeTerminalCwd ?? null,
    context.activeFile ?? null,
    context.activeTerminalPrivate ? "private terminal" : null,
  ].filter((value): value is string => value !== null);
}

function transcriptContextValues(transcript: PiTranscriptItem[]): string[] {
  return transcript
    .flatMap((item) => [
      item.text,
      item.reasoningText,
      item.promptText,
      item.toolName,
      valueText(item.toolInput),
      item.toolOutput?.content,
      item.toolErrorText,
      ...contextValues(item.context),
      ...contextValues(item.promptContext),
    ])
    .filter((value): value is string => Boolean(value));
}

function contextWindowForProvider(
  provider: PiProviderResolution,
): number | null {
  if (!provider.ok) return null;
  return getModelContextLimit(
    provider.config.sourceModelId,
    provider.config.contextLimit,
  );
}

function selectedThinkingLevel(input: {
  availableLevels: readonly PiThinkingLevel[];
  preferredLevel?: PiThinkingLevel | null;
  sessionLevel?: PiThinkingLevel | null;
}): PiThinkingLevel | null {
  if (input.availableLevels.length === 0) return null;
  if (
    input.preferredLevel &&
    input.availableLevels.includes(input.preferredLevel)
  ) {
    return input.preferredLevel;
  }
  if (
    input.sessionLevel &&
    input.availableLevels.includes(input.sessionLevel)
  ) {
    return input.sessionLevel;
  }
  return input.availableLevels.includes("medium")
    ? "medium"
    : (input.availableLevels[0] ?? null);
}

function composerContextUsage(input: {
  provider: PiProviderResolution;
  transcript: PiTranscriptItem[];
}): PiComposerContextUsage | null {
  const contextWindow = contextWindowForProvider(input.provider);
  const tokens = estimateContextTokens(
    transcriptContextValues(input.transcript),
  );
  if (tokens === 0 && contextWindow === null) return null;
  return {
    tokens,
    contextWindow,
    percent:
      contextWindow === null || contextWindow <= 0
        ? null
        : Math.min(100, Number(((tokens / contextWindow) * 100).toFixed(2))),
  };
}

export function buildPiPanelState(input: BuildPiPanelStateInput): PiPanelState {
  const status = getPiStatusView(input.runtimeState);
  const runtimeReady = input.runtimeState.phase === "ready";
  const selectedSession =
    input.sessions.find((session) => session.id === input.selectedSessionId) ??
    null;
  const selectedSessionSendable = isPiSessionSendable(selectedSession);
  const selectedEvents =
    input.selectedSessionId === null
      ? []
      : input.sessionEvents.filter(
          (event) => event.sessionId === input.selectedSessionId,
        );
  const transcript = buildPiSessionTranscript(selectedEvents);
  const promptContext: PiPromptContext = {
    workspaceRoot: selectedSession?.cwd ?? input.workspaceRoot,
    activeTerminalCwd: input.activeCwd,
    activeFile: input.activeFile,
    activeTerminalPrivate: input.activeTerminalPrivate,
  };
  const diagnosticsView = buildPiDiagnosticsView({
    diagnostics: input.diagnostics,
    diagnosticsError: input.diagnosticsError,
    historyError: input.historyError,
    provider: input.provider,
    providerKeyStatus: input.providerKeyStatus,
    runtimeState: input.runtimeState,
    workspaceRoot: input.workspaceRoot,
  });
  const reason = sendDisabledReason({
    isBusy: input.isBusy,
    prompt: input.prompt,
    runtimeReady,
    selectedSession,
    selectedSessionSendable,
  });
  const running = selectedSession?.status === "running";
  const canCreateSession =
    runtimeReady &&
    input.workspaceRoot !== null &&
    input.provider.ok &&
    !input.isBusy;
  const availableThinkingLevels = [
    ...piThinkingLevelsForProvider(input.provider),
  ];

  return {
    composer: {
      availableThinkingLevels,
      canCreateSession,
      canSend: reason === null,
      canStop:
        runtimeReady && selectedSession !== null && running && !input.isBusy,
      contextUsage: composerContextUsage({
        provider: input.provider,
        transcript,
      }),
      disabled: reason !== null,
      hint:
        reason ??
        composerHint({
          prompt: input.prompt,
          runtimeReady,
          selectedSession,
          selectedSessionSendable,
        }),
      prompt: input.prompt,
      queuedPrompts: [],
      running,
      selectedModel: selectedModel(input.provider),
      sendDisabledReason: reason,
      thinkingLevel: selectedThinkingLevel({
        availableLevels: availableThinkingLevels,
        preferredLevel: input.thinkingLevel,
        sessionLevel: selectedSession?.thinkingLevel,
      }),
    },
    context: {
      preview: buildPiContextPreview(promptContext, selectedSession?.cwd),
      prompt: promptContext,
    },
    diagnostics: {
      view: diagnosticsView,
    },
    runtime: {
      ready: runtimeReady,
      state: input.runtimeState,
      status,
    },
    sessions: {
      all: input.sessions,
      selected: selectedSession,
      selectedEvents,
      selectedSendable: selectedSessionSendable,
      transcript,
    },
  };
}
