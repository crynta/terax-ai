/**
 * Webview-backed Pi Session Manager
 *
 * Manages Pi SDK Agent sessions entirely in the webview,
 * producing the PiSession/PiSessionEvent types consumed by the sidebar.
 *
 * This is the only active Pi session backend; legacy native session entry
 * points are routed here for compatibility.
 */
import type { Agent, AgentMessage } from "@earendil-works/pi-agent-core";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { estimateCost } from "../../ai/config";
import { createTauriAgent, resolveAgentModel } from "../bridge/pi-session";
import {
  buildSystemPromptWithSkills,
  resolveSkillFiles,
} from "../bridge/pi-skills";
import { PendingApprovalRegistry } from "./approval-registry";
import {
  buildPromptWithContext,
  readProjectMemory,
  withProjectMemory,
} from "./prompt-context";
import type { PiProviderRuntimeConfig } from "./provider";
import { PendingQuestionRegistry } from "./question-registry";
import type {
  PiPromptContext,
  PiQuestionAnswer,
  PiQuestionOption,
  PiSessionEvent,
} from "./sessions";
import {
  PI_SESSION_EVENT,
  type PiSession,
  type PiSessionCreateResult,
  type PiSessionDeleteResult,
  type PiSessionRenameResult,
  type PiSessionResumeResult,
  type PiSessionSendResult,
  type PiSessionStopResult,
} from "./sessions";
import { createAgentEventTranslator } from "./sessions/agent-events";
import {
  deserializeAgentTranscript,
  eventsToAgentMessages,
  prepareTranscriptForResume,
  serializeAgentTranscript,
} from "./sessions/agent-transcript";
import { nextPiEventId } from "./sessions/events";
import { computeTurnDiff } from "./sessions/turn-diff";
import {
  type ApprovalPolicy,
  buildToolApprovalPolicies,
  type CapabilityManifest,
  resolveToolApproval,
} from "./tool-approval-policy";
import { v4 as uuid } from "./uuid";

// ─── In-memory state ───

/** Persistent session metadata — survives across send/resume calls */
interface SessionRecord {
  agent: Agent;
  session: PiSession;
  modelId: string;
  providerId: string;
  /** Tool name → approval policy, sourced from the Rust capability manifest. */
  approvalPolicies: Map<string, ApprovalPolicy>;
}

const sessions = new Map<string, SessionRecord>();

// ─── Tool Approval Gate ───

/** In-flight tool approvals, resolved on user response or session teardown. */
const pendingApprovals = new PendingApprovalRegistry();

/** In-flight interactive questions, resolved on user answer or teardown. */
const pendingQuestions = new PendingQuestionRegistry();

/**
 * Ask the user a multiple-choice question and block until they answer. Emits a
 * QuestionAsked event the UI renders as choices; resolves when the user
 * responds via webviewSessionQuestionRespond, the session is torn down, or the
 * agent aborts (empty answers).
 */
function requestQuestion(
  sessionId: string,
  questionId: string,
  params: {
    question: string;
    options: PiQuestionOption[];
    allowMultiple: boolean;
  },
  signal?: AbortSignal,
): Promise<PiQuestionAnswer[]> {
  emitEvent(sessionId, {
    id: nextPiEventId(),
    type: PI_SESSION_EVENT.QuestionAsked,
    sessionId,
    createdAt: new Date().toISOString(),
    payload: {
      questionId,
      question: params.question,
      options: params.options,
      allowMultiple: params.allowMultiple,
    },
  });

  return new Promise<PiQuestionAnswer[]>((resolve) => {
    pendingQuestions.add(sessionId, questionId, resolve);
    signal?.addEventListener(
      "abort",
      () => pendingQuestions.respond(sessionId, questionId, []),
      { once: true },
    );
  });
}

/**
 * Fetch the current tool-approval policies from the Rust capability manifest
 * (the single policy authority). Falls back to safe native defaults if the
 * manifest can't be fetched so tools still behave sensibly offline.
 */
async function loadApprovalPolicies(): Promise<Map<string, ApprovalPolicy>> {
  try {
    const manifest = await invoke<CapabilityManifest>("pi_capability_manifest");
    return buildToolApprovalPolicies(manifest);
  } catch {
    return buildToolApprovalPolicies(undefined);
  }
}

/** Read TERAX.md project memory for a workspace via Tauri-backed file IO. */
function loadProjectMemory(
  workspaceRoot: string | null | undefined,
): Promise<string | null> {
  return readProjectMemory(workspaceRoot, async (path) => {
    try {
      // Lazy import so the workspace/settings module graph isn't pulled in
      // until needed (keeps it out of mocked test module graphs).
      const { piBridgeTools } = await import("../bridge/pi-tools");
      const result = await piBridgeTools.readFile(path, workspaceRoot ?? "/");
      return "content" in result ? (result.content ?? null) : null;
    } catch {
      return null;
    }
  });
}

// ─── Helpers ───

function updateSession(
  sessionId: string,
  patch: Partial<PiSession>,
): PiSession {
  const record = sessions.get(sessionId);
  if (!record) throw new Error(`Session ${sessionId} not found`);
  Object.assign(record.session, patch, { updatedAt: new Date().toISOString() });
  return { ...record.session };
}

function getSession(sessionId: string): SessionRecord {
  const record = sessions.get(sessionId);
  if (!record) throw new Error(`Session ${sessionId} not found`);
  return record;
}

type PiSessionProviderMetadata = Pick<
  PiSession,
  | "authMode"
  | "providerId"
  | "modelId"
  | "sourceModelId"
  | "baseUrl"
  | "customEndpointId"
>;

function sessionProviderMetadata(
  providerConfig: PiProviderRuntimeConfig | null | undefined,
  provider: string,
  modelId: string,
): PiSessionProviderMetadata {
  return {
    authMode: providerConfig?.authMode ?? "terax",
    providerId: provider,
    modelId,
    sourceModelId: providerConfig?.sourceModelId ?? modelId,
    baseUrl: providerConfig?.baseUrl ?? null,
    customEndpointId: providerConfig?.customEndpointId ?? null,
  };
}

function providerConfigFromSession(
  session: PiSession,
): PiProviderRuntimeConfig | null {
  if (!session.providerId || !session.modelId) return null;
  return {
    authMode: session.authMode ?? "terax",
    provider: session.providerId,
    modelId: session.modelId,
    sourceModelId: session.sourceModelId ?? session.modelId,
    baseUrl: session.baseUrl ?? undefined,
    customEndpointId: session.customEndpointId ?? undefined,
    thinkingLevel: session.thinkingLevel ?? undefined,
  };
}

/**
 * Emit a Pi session event in real-time via Tauri's event system.
 * The UI listens for "pi:session-event"
 * via usePiSessionEventStream and updates reactively.
 */
/**
 * Event types that must survive a restart even though they're emitted live:
 * usage telemetry, and the interactive prompts (tool approvals, questions) so a
 * reopened session re-renders them with their answered/cancelled state instead
 * of losing them. Streaming deltas are deliberately excluded (the 500-event
 * store cap; the canonical AgentMessage[] transcript is their durable source).
 */
const DURABLE_UI_EVENT_TYPES = new Set<string>([
  PI_SESSION_EVENT.Usage,
  PI_SESSION_EVENT.ToolApprovalRequested,
  PI_SESSION_EVENT.ToolApprovalResponded,
  PI_SESSION_EVENT.QuestionAsked,
  PI_SESSION_EVENT.QuestionResponded,
]);

function emitEvent(
  _sessionId: string,
  event: PiSessionEvent,
  collector?: PiSessionEvent[] | null,
): void {
  // Emit to the UI via Tauri event bus (real-time streaming)
  emit("pi:session-event", event).catch(() => {
    // Event emission failure is non-fatal — events are also collected
  });
  // Persist the durable subset so it reloads after a restart.
  if (DURABLE_UI_EVENT_TYPES.has(event.type)) {
    invoke("pi_store_record_events", { events: [event] }).catch(() => {
      // Persistence failure is non-fatal for these UI-facing events.
    });
  }
  // Collect events for turn-diff computation (session-scoped)
  if (collector) {
    collector.push(event);
  }
}

/**
 * Persist a session + events to disk via the existing Rust store.
 *
 * Uses the established `pi-sessions.json` format,
 * so sessions survive across both paths and across restarts.
 * These commands do NOT require PiHost to be running.
 */
async function persistSession(
  session: PiSession,
  events: PiSessionEvent[],
): Promise<void> {
  try {
    await invoke("pi_store_record_session", { session, events });
  } catch (e) {
    console.warn("Failed to persist session:", e);
  }
}

async function persistEvents(events: PiSessionEvent[]): Promise<void> {
  try {
    await invoke("pi_store_record_events", { events });
  } catch (e) {
    console.warn("Failed to persist events:", e);
  }
}

// ─── Session factory ───

/**
 * Request tool approval from the user.
 * Emits a ToolApprovalRequested event and waits for the user to respond
 * via webviewSessionToolRespond.
 * Returns true if approved, false if denied.
 */
function requestToolApproval(
  sessionId: string,
  toolName: string,
  toolCallId: string,
  input: unknown,
): Promise<boolean> {
  const record = sessions.get(sessionId);
  const policies =
    record?.approvalPolicies ?? buildToolApprovalPolicies(undefined);
  const policy = resolveToolApproval(toolName, policies);

  // Blocked tools never execute; auto tools run without prompting. Only "ask"
  // tools (including MCP tools the policy marks as ask) request approval.
  if (policy === "deny") {
    return Promise.resolve(false);
  }
  if (policy !== "ask") {
    return Promise.resolve(true);
  }

  // Emit approval requested event
  const approvalId = toolCallId;
  emitEvent(sessionId, {
    id: nextPiEventId(),
    type: PI_SESSION_EVENT.ToolApprovalRequested,
    sessionId,
    createdAt: new Date().toISOString(),
    payload: { toolCallId, approvalId, toolName, input },
  });

  // Resolves on user response, session teardown (clearForSession), or timeout.
  return new Promise<boolean>((resolve) => {
    pendingApprovals.add(sessionId, toolCallId, resolve);

    // Backstop: auto-deny after 5 minutes if no response arrives. respond() is
    // idempotent, so this is a no-op once already resolved.
    setTimeout(() => {
      pendingApprovals.respond(sessionId, toolCallId, false);
    }, 300_000);
  });
}

export async function webviewSessionCreate(
  title?: string,
  cwd?: string | null,
  providerConfig?: PiProviderRuntimeConfig | null,
  skillsMode?: unknown,
  selectedSkills?: unknown,
  // Unattended sessions (workflow runs) pre-approve their tools: the workflow
  // node was already user-approved, matching the old native path's
  // `policy: { approved: true }`. Rust still records and audits every grant.
  autoApproveTools = false,
): Promise<PiSessionCreateResult> {
  const sessionId = uuid();
  const now = new Date().toISOString();
  const workingDir = cwd ?? "/";

  const provider = providerConfig?.provider ?? "anthropic";
  const modelId = providerConfig?.modelId ?? "claude-sonnet-4-20250514";

  // Resolve skills and build system prompt
  const skills = await resolveSkillFiles(
    workingDir,
    skillsMode,
    selectedSkills,
  );
  const systemPrompt = withProjectMemory(
    buildSystemPromptWithSkills(
      "You are a helpful AI coding assistant running inside Terax. You have access to file and shell tools.",
      skills,
    ),
    await loadProjectMemory(workingDir),
  );

  const agent = await createTauriAgent({
    cwd: workingDir,
    sessionId,
    systemPrompt,
    provider,
    modelId,
    baseUrl: providerConfig?.baseUrl,
    customEndpointId: providerConfig?.customEndpointId,
    thinkingLevel: providerConfig?.thinkingLevel,
    // Auto-approve mode skips the interactive gate (and the question tool),
    // since there is no user to respond during an unattended run.
    approvalGate: autoApproveTools
      ? () => Promise.resolve(true)
      : (toolName, toolCallId, input) =>
          requestToolApproval(sessionId, toolName, toolCallId, input),
    questionGate: autoApproveTools
      ? undefined
      : (toolCallId, params, signal) =>
          requestQuestion(sessionId, toolCallId, params, signal),
  });

  const session: PiSession = {
    id: sessionId,
    title: title ?? "New session",
    cwd: workingDir,
    status: "idle",
    createdAt: now,
    updatedAt: now,
    lastPrompt: null,
    ...sessionProviderMetadata(providerConfig, provider, modelId),
  };

  const approvalPolicies = await loadApprovalPolicies();
  sessions.set(sessionId, {
    agent,
    session,
    modelId,
    providerId: provider,
    approvalPolicies,
  });

  const events: PiSessionEvent[] = [
    {
      id: nextPiEventId(),
      type: PI_SESSION_EVENT.Created,
      sessionId,
      createdAt: now,
      payload: { session },
    },
  ];

  // Persist to disk (pi-sessions.json + transcript blob).
  await persistSession(session, events);

  return { session, events };
}

export async function webviewSessionSend(
  sessionId: string,
  promptText: string,
  context?: PiPromptContext | null,
  options?: { thinkingLevel?: unknown; regenerateBranchGroupId?: string },
): Promise<PiSessionSendResult> {
  const { agent } = getSession(sessionId);

  // Guard against concurrent sends — the Agent is single-threaded.
  if (agent.state.isStreaming) {
    return {
      accepted: false,
      session: getSession(sessionId).session,
      events: [],
    };
  }

  // Handle regeneration: truncate message history to the branch point.
  // The raw Agent appends to messages, so truncating before prompt()
  // effectively creates a new branch.
  if (options?.regenerateBranchGroupId) {
    const messages = agent.state.messages;
    // Find the last assistant message, then walk back further to find
    // the user message that preceded it. Remove the full exchange.
    let branchIndex = messages.length;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant") {
        // Walk backwards from this assistant message to remove any preceding
        // tool results (from tool_use blocks in this assistant turn) and
        // the user message that triggered this turn.
        let cutAt = i;
        for (let j = i - 1; j >= 0; j--) {
          const prev = messages[j];
          if (prev.role === "toolResult" || prev.role === "user") {
            cutAt = j;
            if (prev.role === "user") break; // stop at the user message
          } else {
            break;
          }
        }
        branchIndex = cutAt;
        break;
      }
    }
    if (branchIndex < messages.length) {
      // Repair any tool-call/result pair the ad-hoc cut left dangling so the
      // next provider request is well-formed (the cut can land mid-pair).
      agent.state.messages = prepareTranscriptForResume(
        messages.slice(0, branchIndex),
      );
    }
  }

  const now = new Date().toISOString();
  let lastError: string | undefined;
  const turnCollector: PiSessionEvent[] = [];

  // Input event — carries the live context so the UI can show what the agent
  // was given (workspace root, active file, terminal cwd).
  const inputEventId = nextPiEventId();
  emitEvent(
    sessionId,
    {
      id: inputEventId,
      type: PI_SESSION_EVENT.Input,
      sessionId,
      createdAt: now,
      payload: { text: promptText, ...(context ? { context } : {}) },
    },
    turnCollector,
  );

  // Status: running
  emitEvent(
    sessionId,
    {
      id: nextPiEventId(),
      type: PI_SESSION_EVENT.Status,
      sessionId,
      createdAt: now,
      payload: { status: "running" },
    },
    turnCollector,
  );

  // The translator owns the streaming output/reasoning/tool mapping using the
  // SDK's own delta events (see sessions/agent-events.ts). Session-level
  // concerns (usage, turn diff, final status) are handled here on agent_end.
  const translator = createAgentEventTranslator({
    sessionId,
    newId: nextPiEventId,
    now: () => new Date().toISOString(),
  });

  const unsub = agent.subscribe((event, signal) => {
    if (event.type === "agent_end") {
      const finalStatus = signal?.aborted ? "stopped" : "idle";
      // Emit usage telemetry if available
      const usage = (
        event as {
          totalUsage?: {
            inputTokens?: number;
            outputTokens?: number;
            inputTokenDetails?: { cacheReadTokens?: number };
          };
        }
      ).totalUsage;
      if (usage) {
        const record = sessions.get(sessionId);
        const modelId = record?.modelId;
        const providerId = record?.providerId;
        const inputTokens = usage.inputTokens ?? 0;
        const outputTokens = usage.outputTokens ?? 0;
        const cachedInputTokens = usage.inputTokenDetails?.cacheReadTokens ?? 0;
        const costUsd = estimateCost(modelId, {
          inputTokens,
          outputTokens,
          cachedInputTokens,
        });
        emitEvent(
          sessionId,
          {
            id: nextPiEventId(),
            type: PI_SESSION_EVENT.Usage,
            sessionId,
            createdAt: new Date().toISOString(),
            payload: {
              inputTokens,
              outputTokens,
              cachedInputTokens: cachedInputTokens || null,
              costUsd,
              modelId: modelId ?? null,
              providerId: providerId ?? null,
            },
          },
          turnCollector,
        );
      }
      // Emit turn diff — structured summary of what changed in this turn
      const diff = computeTurnDiff(turnCollector, inputEventId, null);
      if (
        diff.files.length > 0 ||
        diff.commands.length > 0 ||
        diff.toolCalls.length > 0 ||
        diff.usage
      ) {
        emitEvent(
          sessionId,
          {
            id: nextPiEventId(),
            type: PI_SESSION_EVENT.TurnDiff,
            sessionId,
            createdAt: new Date().toISOString(),
            payload: {
              inputEventId,
              files: diff.files,
              commands: diff.commands,
              usage: diff.usage,
              toolCalls: diff.toolCalls,
            },
          },
          turnCollector,
        );
      }
      emitEvent(
        sessionId,
        {
          id: nextPiEventId(),
          type: PI_SESSION_EVENT.Status,
          sessionId,
          createdAt: new Date().toISOString(),
          payload: { status: finalStatus },
        },
        turnCollector,
      );
      return;
    }

    for (const piEvent of translator.translate(event)) {
      emitEvent(sessionId, piEvent, turnCollector);
    }
  });

  try {
    // Apply thinking level from UI before each prompt
    if (
      options?.thinkingLevel &&
      options.thinkingLevel !== "off" &&
      ["minimal", "low", "medium", "high", "xhigh"].includes(
        options.thinkingLevel as string,
      )
    ) {
      agent.state.thinkingLevel = options.thinkingLevel as
        | "minimal"
        | "low"
        | "medium"
        | "high"
        | "xhigh";
    }
    // Inject the live IDE context as an <env> block on the turn the model
    // sees, while the transcript keeps the user's original prompt text.
    await agent.prompt(buildPromptWithContext(promptText, context));
  } catch (e) {
    // Distinguish abort from real errors.
    // On abort, agent_end may have already emitted "stopped" via subscribe.
    // We only emit error status for genuine (non-abort) failures.
    const isAbort = e instanceof DOMException && e.name === "AbortError";
    if (!isAbort) {
      lastError = String(e);
      emitEvent(
        sessionId,
        {
          id: nextPiEventId(),
          type: PI_SESSION_EVENT.Error,
          sessionId,
          createdAt: new Date().toISOString(),
          payload: { message: lastError },
        },
        turnCollector,
      );
      emitEvent(
        sessionId,
        {
          id: nextPiEventId(),
          type: PI_SESSION_EVENT.Status,
          sessionId,
          createdAt: new Date().toISOString(),
          payload: { status: "error" },
        },
        turnCollector,
      );
    }
  } finally {
    unsub();
  }

  // Persist the canonical transcript so the session can be resumed, forked, or
  // rolled back after a restart (the in-memory Agent is otherwise lost).
  await persistTranscript(sessionId, agent.state.messages);

  const session = updateSession(sessionId, {
    status: lastError ? "error" : "idle",
    lastPrompt: promptText,
  });

  // Persist the updated session to disk
  await persistSession(session, []);

  return { accepted: true, session, events: [] };
}

/** Persist a session's canonical AgentMessage[] transcript (best effort). */
async function persistTranscript(
  sessionId: string,
  messages: AgentMessage[],
): Promise<void> {
  try {
    await invoke("pi_store_record_transcript", {
      sessionId,
      transcript: serializeAgentTranscript(messages),
    });
  } catch (e) {
    console.warn("Failed to persist transcript:", e);
  }
}

// ─── Resume session ───

/**
 * Reconstruct an in-memory session from durable storage when it isn't present
 * (e.g. after an app restart, when the `sessions` Map is empty). Loads the
 * session metadata from the shared store and seeds a fresh Agent with the
 * persisted, integrity-repaired transcript so the conversation can continue.
 */
async function rehydrateSession(
  sessionId: string,
  providerConfig?: PiProviderRuntimeConfig | null,
): Promise<SessionRecord> {
  let stored: PiSession | undefined;
  try {
    const history = await invoke<{ sessions: PiSession[] }>(
      "pi_sessions_history",
    );
    stored = history.sessions.find((entry) => entry.id === sessionId);
  } catch {
    stored = undefined;
  }
  if (!stored) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const effectiveProviderConfig =
    providerConfig ?? providerConfigFromSession(stored);
  const provider = effectiveProviderConfig?.provider ?? "anthropic";
  const modelId =
    effectiveProviderConfig?.modelId ?? "claude-sonnet-4-20250514";

  let messages: AgentMessage[] = [];
  try {
    const raw = await invoke<string | null>("pi_store_load_transcript", {
      sessionId,
    });
    if (raw) {
      messages = prepareTranscriptForResume(deserializeAgentTranscript(raw));
    }
  } catch {
    messages = [];
  }

  const agent = await createTauriAgent({
    cwd: stored.cwd ?? "/",
    sessionId,
    provider,
    modelId,
    baseUrl: effectiveProviderConfig?.baseUrl,
    customEndpointId: effectiveProviderConfig?.customEndpointId,
    thinkingLevel:
      effectiveProviderConfig?.thinkingLevel ??
      stored.thinkingLevel ??
      undefined,
    approvalGate: (toolName, toolCallId, input) =>
      requestToolApproval(sessionId, toolName, toolCallId, input),
    questionGate: (toolCallId, params, signal) =>
      requestQuestion(sessionId, toolCallId, params, signal),
  });
  agent.state.messages = messages;

  const record: SessionRecord = {
    agent,
    session: { ...stored },
    modelId,
    providerId: provider,
    approvalPolicies: await loadApprovalPolicies(),
  };
  sessions.set(sessionId, record);
  return record;
}

export async function webviewSessionResume(
  sessionId: string,
  providerConfig?: PiProviderRuntimeConfig | null,
  skillsMode?: unknown,
  selectedSkills?: unknown,
): Promise<PiSessionResumeResult> {
  const record =
    sessions.get(sessionId) ??
    (await rehydrateSession(sessionId, providerConfig));

  // Update model/provider if config changed (e.g., user switched models) and
  // apply the new model to the live agent so the next turn actually uses it.
  if (providerConfig) {
    record.modelId = providerConfig.modelId;
    record.providerId = providerConfig.provider;
    Object.assign(
      record.session,
      sessionProviderMetadata(
        providerConfig,
        providerConfig.provider,
        providerConfig.modelId,
      ),
    );
    record.agent.state.model = resolveAgentModel({
      provider: providerConfig.provider,
      modelId: providerConfig.modelId,
      baseUrl: providerConfig.baseUrl,
    });
  }

  // Refresh approval policies so MCP/manifest changes since creation apply.
  record.approvalPolicies = await loadApprovalPolicies();

  // Re-resolve skills and update agent's system prompt
  const skills = await resolveSkillFiles(
    record.session.cwd ?? "/",
    skillsMode,
    selectedSkills,
  );
  const systemPrompt = withProjectMemory(
    buildSystemPromptWithSkills(
      "You are a helpful AI coding assistant running inside Terax. You have access to file and shell tools.",
      skills,
    ),
    await loadProjectMemory(record.session.cwd),
  );
  record.agent.state.systemPrompt = systemPrompt;

  const now = new Date().toISOString();
  const session = updateSession(sessionId, { status: "idle" });

  const result = {
    session,
    events: [
      {
        id: nextPiEventId(),
        type: PI_SESSION_EVENT.Resumed,
        sessionId,
        createdAt: now,
        payload: { session },
      },
    ],
  };

  await persistSession(session, result.events);
  return result;
}

// ─── Fork & rollback ───

/**
 * Reconstruct and persist a session's canonical transcript from its current
 * (post-command) event log. Fork and rollback truncate/copy the event log in
 * Rust; this rebuilds the agent-ready transcript from whatever events remain so
 * the webview agent stays in sync without correlating event ids to messages.
 */
async function rebuildTranscriptFromStore(sessionId: string): Promise<void> {
  try {
    const history = await invoke<{ events: PiSessionEvent[] }>(
      "pi_sessions_history",
    );
    const events = history.events.filter(
      (entry) => entry.sessionId === sessionId,
    );
    const messages = prepareTranscriptForResume(eventsToAgentMessages(events));
    await invoke("pi_store_record_transcript", {
      sessionId,
      transcript: serializeAgentTranscript(messages),
    });
  } catch (e) {
    console.warn("Failed to rebuild transcript from store:", e);
  }
}

export async function webviewSessionFork(
  parentSessionId: string,
  forkEventId?: string | null,
  title?: string | null,
): Promise<{ session: PiSession; events: PiSessionEvent[] }> {
  const result = await invoke<{ session: PiSession; events: PiSessionEvent[] }>(
    "pi_session_fork",
    { parentSessionId, forkEventId: forkEventId ?? null, title: title ?? null },
  );
  // Seed the forked session's durable transcript from its copied event log so
  // it can be resumed and continued in the webview path.
  await rebuildTranscriptFromStore(result.session.id);
  return result;
}

export async function webviewSessionRollback(
  sessionId: string,
  rollbackEventId: string,
): Promise<{ session: PiSession; removedEventCount: number }> {
  // Preserve the active provider/model so the rebuilt agent keeps using it.
  const existing = sessions.get(sessionId);
  const providerConfig = existing
    ? (providerConfigFromSession(existing.session) ??
      ({
        authMode: "terax",
        provider: existing.providerId,
        modelId: existing.modelId,
        sourceModelId: existing.modelId,
      } as PiProviderRuntimeConfig))
    : null;

  const result = await invoke<{
    session: PiSession;
    removedEventCount: number;
  }>("pi_session_rollback", { sessionId, rollbackEventId });

  // The event log was truncated in Rust; rebuild the canonical transcript and
  // replace the now-stale in-memory agent so the session continues from the
  // rolled-back point instead of desyncing.
  await rebuildTranscriptFromStore(sessionId);
  sessions.delete(sessionId);
  await rehydrateSession(sessionId, providerConfig).catch(() => {});

  return result;
}

// ─── Stop session ───

export async function webviewSessionStop(
  sessionId: string,
): Promise<PiSessionStopResult> {
  const { agent } = getSession(sessionId);
  agent.abort();
  // Deny any tool awaiting approval and cancel any pending question so neither
  // can resolve after the stop.
  pendingApprovals.clearForSession(sessionId);
  pendingQuestions.clearForSession(sessionId);
  // Drop any recorded single-use approval grants on the Rust side so they don't
  // linger past teardown (best effort — never blocks the stop).
  invoke("pi_agent_session_forget", { sessionId }).catch(() => {});

  const now = new Date().toISOString();
  const session = updateSession(sessionId, { status: "stopped" });

  const result: PiSessionStopResult = {
    session,
    events: [
      {
        id: nextPiEventId(),
        type: PI_SESSION_EVENT.Status,
        sessionId,
        createdAt: now,
        payload: { status: "stopped" },
      },
    ],
  };
  await persistSession(session, result.events);
  return result;
}

// ─── Rename session ───

export async function webviewSessionRename(
  sessionId: string,
  title: string,
): Promise<PiSessionRenameResult> {
  const now = new Date().toISOString();
  const session = updateSession(sessionId, { title });

  const result: PiSessionRenameResult = {
    session,
    events: [
      {
        id: nextPiEventId(),
        type: PI_SESSION_EVENT.Renamed,
        sessionId,
        createdAt: now,
        payload: { title },
      },
    ],
  };
  await persistSession(session, result.events);
  return result;
}

// ─── Delete session ───

export async function webviewSessionDelete(
  sessionId: string,
): Promise<PiSessionDeleteResult> {
  const { agent } = getSession(sessionId);
  agent.abort();
  // Deny any tool awaiting approval / cancel any question before teardown.
  pendingApprovals.clearForSession(sessionId);
  pendingQuestions.clearForSession(sessionId);
  sessions.delete(sessionId);

  // Remove the durable transcript blob and any Rust-side approval grants
  // (best effort — never blocks deletion).
  invoke("pi_store_delete_transcript", { sessionId }).catch(() => {});
  invoke("pi_agent_session_forget", { sessionId }).catch(() => {});

  const result: PiSessionDeleteResult = {
    events: [
      {
        id: nextPiEventId(),
        type: PI_SESSION_EVENT.Deleted,
        sessionId,
        createdAt: new Date().toISOString(),
        payload: { sessionId },
      },
    ],
  };
  await persistEvents(result.events);
  return result;
}

// ─── Delete session with artifacts ───

export async function webviewSessionDeleteWithArtifacts(
  sessionId: string,
): Promise<import("./sessions").PiSessionDeleteWithArtifactsResult> {
  const sessionDelete = await webviewSessionDelete(sessionId);

  // Attempt artifact cleanup through the Rust artifact store
  let artifactDelete: import("./sessions").PiArtifactDeleteResult | null = null;
  let artifactCleanupError: string | null = null;
  try {
    const result = await invoke<{
      deleted: number;
      deletedCount: number;
    } | null>("artifacts_delete_for_conversation", {
      conversationId: sessionId,
    });
    if (result) {
      artifactDelete = {
        deleted: result.deletedCount > 0,
        deletedCount: result.deletedCount,
      };
    }
  } catch (e) {
    artifactCleanupError = e instanceof Error ? e.message : String(e);
  }

  return {
    sessionDelete,
    artifactDelete,
    artifactCleanupError,
  };
}

// ─── Tool respond ───

export async function webviewSessionToolRespond(
  sessionId: string,
  toolCallId: string,
  approved: boolean,
): Promise<{ session: PiSession; events: PiSessionEvent[] }> {
  pendingApprovals.respond(sessionId, toolCallId, approved);
  const session = updateSession(sessionId, {});
  const events: PiSessionEvent[] = [
    {
      id: nextPiEventId(),
      type: PI_SESSION_EVENT.ToolApprovalResponded,
      sessionId,
      createdAt: new Date().toISOString(),
      payload: {
        toolCallId,
        approvalId: toolCallId,
        approved,
      },
    },
  ];
  await persistEvents(events);
  return { session, events };
}

// ─── Question respond ───

export async function webviewSessionQuestionRespond(
  sessionId: string,
  questionId: string,
  answers: PiQuestionAnswer[],
): Promise<{ session: PiSession; events: PiSessionEvent[] }> {
  // Unblock the waiting ask_question tool with the user's selection.
  const handled = pendingQuestions.respond(sessionId, questionId, answers);
  const session = updateSession(sessionId, {});
  const events: PiSessionEvent[] = [
    {
      id: nextPiEventId(),
      type: PI_SESSION_EVENT.QuestionResponded,
      sessionId,
      createdAt: new Date().toISOString(),
      payload: { questionId, answers },
    },
  ];
  // Only emit/persist for a question that was actually pending. A double-submit
  // (already answered) still returns the event for idempotent UI application,
  // but must not write an orphan event to the durable log.
  if (handled) {
    emitEvent(sessionId, events[0]);
  }
  return { session, events };
}
