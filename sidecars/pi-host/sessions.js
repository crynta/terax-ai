import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import {
  basename,
  isAbsolute,
  relative,
  resolve as resolvePath,
  sep,
} from "node:path";
import {
  createTeraxNativeToolDefinitions,
  RUST_MEDIATED_TOOL_NAMES,
} from "./native-tools.js";
import { createRuntimeProviderOptions } from "./provider-config.js";
import {
  friendlySessionErrorMessage,
  SessionProtocolError,
} from "./session-errors.js";

export { SessionProtocolError } from "./session-errors.js";

const INVALID_PARAMS = -32602;
const SESSION_NOT_FOUND = -32004;
const SESSION_STOPPED = -32005;
const RESOURCE_LIMIT = -32006;
const SESSION_BUSY = -32007;
export const MAX_SESSIONS = 20;
export const MAX_PROMPT_CHARS = 20_000;
export const MAX_SESSION_TITLE_CHARS = 256;

const THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);
export const APPROVAL_TOOL_NAMES = ["bash", "edit", "write"];
export const ENABLED_TOOL_NAMES = RUST_MEDIATED_TOOL_NAMES;
export const TOOL_MODE = "rust-mediated";

const APPROVAL_NOT_FOUND = -32008;

const WORKSPACE_ONLY_TOOLS = new Set([
  "read",
  "ls",
  "grep",
  "find",
  "edit",
  "write",
]);
const APPROVAL_REQUIRED_TOOLS = new Set(APPROVAL_TOOL_NAMES);
const SENSITIVE_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".npmrc",
  ".netrc",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
]);

let nextSessionNumber = 1;
let nextEventNumber = 1;
let sessionEventSink = () => {};
const sessions = new Map();

function isoNow() {
  return new Date().toISOString();
}

function shortRandomId() {
  return randomUUID().replaceAll("-", "").slice(0, 12);
}

function timestampIdPart() {
  return Date.now().toString(36);
}

function createSessionId() {
  return `pi_${timestampIdPart()}_${shortRandomId()}`;
}

function createEventId(sequence) {
  return `evt_${timestampIdPart()}_${sequence}_${shortRandomId()}`;
}

function createBranchGroupId() {
  return `turn_${timestampIdPart()}_${shortRandomId()}`;
}

function sessionSnapshot(session) {
  const {
    agentSession: _agentSession,
    unsubscribe: _unsubscribe,
    cleanup: _cleanup,
    activeRunId: _activeRunId,
    cancelledRunId: _cancelledRunId,
    providerConfig: _providerConfig,
    sessionDir: _sessionDir,
    workspaceEnv: _workspaceEnv,
    autoTitle: _autoTitle,
    agentGeneration: _agentGeneration,
    branchGroups: _branchGroups,
    activeBranch: _activeBranch,
    toolInputs: _toolInputs,
    pendingApprovals: _pendingApprovals,
    ...snapshot
  } = session;
  return { ...snapshot };
}

function sessionEvent(type, sessionId, payload, createdAt = isoNow()) {
  const sequence = nextEventNumber;
  return {
    id: createEventId(sequence),
    type,
    sessionId,
    createdAt,
    payload,
  };
}

function pushEvent(type, sessionId, payload, createdAt) {
  const event = sessionEvent(type, sessionId, payload, createdAt);
  nextEventNumber += 1;
  return event;
}

function publishEvent(type, sessionId, payload, createdAt) {
  const event = pushEvent(type, sessionId, payload, createdAt);
  sessionEventSink(event);
  return event;
}

export function setSessionEventSink(sink) {
  sessionEventSink = typeof sink === "function" ? sink : () => {};
}

function assertParamsObject(params, method) {
  if (params === undefined) {
    return {};
  }
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      `${method} params must be an object`,
    );
  }
  return params;
}

function requiredString(params, key, method) {
  const value = params[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      `${method} requires a non-empty ${key}`,
    );
  }
  return value.trim();
}

function optionalString(params, key, method) {
  const value = params[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      `${method} ${key} must be a non-empty string`,
    );
  }
  return value.trim();
}

function titleFromPrompt(prompt) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= 56) {
    return normalized;
  }
  return `${normalized.slice(0, 55).trimEnd()}…`;
}

function optionalContextString(params, key, method) {
  const value = optionalString(params, key, method);
  if (value === undefined) {
    return undefined;
  }
  if (/\r|\n/.test(value)) {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      `${method} ${key} must not contain newlines`,
    );
  }
  return value;
}

function optionalThinkingLevel(params, key, method) {
  const value = optionalContextString(params, key, method);
  if (value === undefined) {
    return undefined;
  }
  if (!THINKING_LEVELS.has(value)) {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      `${method} ${key} is not supported: ${value}`,
    );
  }
  return value;
}

function normalizeWorkspaceEnv(value, method) {
  if (value === undefined || value === null) {
    return { kind: "local" };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      `${method} workspaceEnv must be an object`,
    );
  }
  if (value.kind === "local") {
    return { kind: "local" };
  }
  if (value.kind === "wsl") {
    if (typeof value.distro !== "string" || value.distro.trim() === "") {
      throw new SessionProtocolError(
        INVALID_PARAMS,
        `${method} workspaceEnv.distro must be a non-empty string`,
      );
    }
    const distro = value.distro.trim();
    if (/\r|\n/.test(distro)) {
      throw new SessionProtocolError(
        INVALID_PARAMS,
        `${method} workspaceEnv.distro must not contain newlines`,
      );
    }
    return { kind: "wsl", distro };
  }
  throw new SessionProtocolError(
    INVALID_PARAMS,
    `${method} workspaceEnv.kind is not supported: ${String(value.kind)}`,
  );
}

function assertBoolean(params, key, method) {
  const value = params[key];
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      `${method} ${key} must be a boolean`,
    );
  }
  return value;
}

function compactContext(context) {
  if (context === undefined) {
    return undefined;
  }
  const result = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined || value === null || value === false) {
      continue;
    }
    result[key] = value;
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

function normalizePromptContext(rawContext, method) {
  if (rawContext === undefined || rawContext === null) {
    return undefined;
  }
  if (typeof rawContext !== "object" || Array.isArray(rawContext)) {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      `${method} context must be an object`,
    );
  }
  return compactContext({
    workspaceRoot: optionalContextString(rawContext, "workspaceRoot", method),
    activeTerminalCwd: optionalContextString(
      rawContext,
      "activeTerminalCwd",
      method,
    ),
    activeFile: optionalContextString(rawContext, "activeFile", method),
    activeTerminalPrivate: assertBoolean(
      rawContext,
      "activeTerminalPrivate",
      method,
    ),
  });
}

function contextWithWorkspace(session, context) {
  return compactContext({
    workspaceRoot: context?.workspaceRoot ?? session.cwd,
    activeTerminalCwd: context?.activeTerminalCwd,
    activeFile: context?.activeFile,
    activeTerminalPrivate: context?.activeTerminalPrivate === true,
  });
}

function providerConfigWithThinkingLevel(providerConfig, thinkingLevel) {
  if (providerConfig === undefined || providerConfig === null) {
    return providerConfig;
  }
  return { ...providerConfig, thinkingLevel };
}

function setSessionThinkingLevel(session, thinkingLevel) {
  if (thinkingLevel === undefined) {
    return;
  }
  session.agentSession.setThinkingLevel(thinkingLevel);
  session.thinkingLevel = session.agentSession.thinkingLevel;
  session.providerConfig = providerConfigWithThinkingLevel(
    session.providerConfig,
    session.thinkingLevel,
  );
}

function payloadWithActiveBranch(session, payload) {
  return session.activeBranch === undefined
    ? payload
    : { ...payload, branch: session.activeBranch };
}

function toolPayload(session, payload) {
  return payloadWithActiveBranch(session, payload);
}

function serializableValue(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function compactToolResult(result) {
  if (!result || typeof result !== "object") {
    return { content: String(result ?? ""), details: null };
  }

  const content = Array.isArray(result.content)
    ? result.content
        .map((part) => {
          if (part?.type === "text") return String(part.text ?? "");
          if (part?.type === "image") return "[image output omitted]";
          return `[${String(part?.type ?? "unknown")} output omitted]`;
        })
        .filter((part) => part.length > 0)
        .join("\n")
    : "";
  return {
    content,
    details: serializableValue(result.details) ?? null,
  };
}

function toolResultText(result) {
  const compact = compactToolResult(result);
  return compact.content || "Tool completed.";
}

function expandHomePath(value) {
  if (value === "~") return homedir();
  if (value.startsWith(`~${sep}`))
    return resolvePath(homedir(), value.slice(2));
  return value;
}

function resolveToolPath(cwd, value) {
  const expanded = expandHomePath(String(value ?? ".").trim() || ".");
  return isAbsolute(expanded)
    ? resolvePath(expanded)
    : resolvePath(cwd, expanded);
}

function isWithinWorkspace(workspaceRoot, candidatePath) {
  const relativePath = relative(
    resolvePath(workspaceRoot),
    resolvePath(candidatePath),
  );
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function isSensitivePath(candidatePath) {
  const parts = resolvePath(candidatePath).split(/[\\/]+/);
  if (parts.some((part) => part === ".ssh" || part === ".gnupg")) {
    return true;
  }
  const name = basename(candidatePath).toLowerCase();
  if (SENSITIVE_FILE_NAMES.has(name)) return true;
  return /(?:^|[._-])(secret|secrets|credential|credentials|token|tokens|private-key)(?:[._-]|$)/i.test(
    name,
  );
}

function toolPathInputs(toolName, args) {
  if (!args || typeof args !== "object") return [];
  switch (toolName) {
    case "read":
    case "edit":
    case "write":
      return typeof args.path === "string" ? [args.path] : [];
    case "ls":
    case "grep":
    case "find":
      return typeof args.path === "string" ? [args.path] : ["."];
    default:
      return [];
  }
}

export function validateToolSafety(session, toolName, args) {
  if (!WORKSPACE_ONLY_TOOLS.has(toolName)) {
    return null;
  }

  for (const rawPath of toolPathInputs(toolName, args)) {
    const resolvedPath = resolveToolPath(session.cwd, rawPath);
    if (!isWithinWorkspace(session.cwd, resolvedPath)) {
      return `${toolName} can only access files inside the workspace: ${session.cwd}`;
    }
    if (isSensitivePath(resolvedPath)) {
      return `${toolName} refused sensitive path: ${rawPath}`;
    }
  }
  return null;
}

export function toolRequiresApproval(toolName) {
  return APPROVAL_REQUIRED_TOOLS.has(toolName);
}

function toolApprovalPayload(session, approval, approved) {
  return toolPayload(session, {
    approvalId: approval.toolCallId,
    toolCallId: approval.toolCallId,
    toolName: approval.toolName,
    input: approval.input,
    ...(typeof approved === "boolean" ? { approved } : {}),
  });
}

function pushToolApprovalRequested(session, approval, createdAt = isoNow()) {
  return publishEvent(
    "session.tool.approval.requested",
    session.id,
    toolApprovalPayload(session, approval),
    createdAt,
  );
}

function pushToolApprovalResponded(
  session,
  approval,
  approved,
  createdAt = isoNow(),
) {
  return pushEvent(
    "session.tool.approval.responded",
    session.id,
    toolApprovalPayload(session, approval, approved),
    createdAt,
  );
}

function publishToolApprovalResponded(
  session,
  approval,
  approved,
  createdAt = isoNow(),
) {
  return publishEvent(
    "session.tool.approval.responded",
    session.id,
    toolApprovalPayload(session, approval, approved),
    createdAt,
  );
}

function resolvePendingApproval(session, approval, approved) {
  if (!session.pendingApprovals.has(approval.toolCallId)) {
    return;
  }
  session.pendingApprovals.delete(approval.toolCallId);
  approval.cleanup?.();
  approval.resolve(approved);
}

function resolveAllPendingApprovals(
  session,
  approved,
  createdAt = isoNow(),
  mode = "push",
) {
  const events = [];
  for (const approval of Array.from(session.pendingApprovals.values())) {
    resolvePendingApproval(session, approval, approved);
    const event =
      mode === "publish"
        ? publishToolApprovalResponded(session, approval, approved, createdAt)
        : pushToolApprovalResponded(session, approval, approved, createdAt);
    events.push(event);
  }
  return events;
}

function waitForToolApproval(session, event, signal) {
  const toolName = event.toolName;
  const toolCallId = event.toolCallId;
  const input = serializableValue(event.input);
  const approval = {
    toolCallId,
    toolName,
    input,
    runId: session.activeRunId,
    cleanup: undefined,
    resolve: undefined,
  };

  const promise = new Promise((resolve) => {
    approval.resolve = resolve;
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const abort = () => resolvePendingApproval(session, approval, false);
    signal?.addEventListener("abort", abort, { once: true });
    approval.cleanup = () => signal?.removeEventListener("abort", abort);
    session.pendingApprovals.set(toolCallId, approval);
    pushToolApprovalRequested(session, approval);
  });

  return promise;
}

async function handleToolApprovalRequest(session, event, signal) {
  const toolName = event.toolName;
  const safetyMessage = validateToolSafety(session, toolName, event.input);
  if (safetyMessage !== null) {
    return { block: true, reason: safetyMessage };
  }

  if (!toolRequiresApproval(toolName)) {
    return undefined;
  }

  const approved = await waitForToolApproval(session, event, signal);
  return approved
    ? undefined
    : { block: true, reason: `Tool ${toolName} denied by user` };
}

function createApprovalExtension(session) {
  return (pi) => {
    pi.on("tool_call", (event, context) =>
      handleToolApprovalRequest(session, event, context.signal),
    );
  };
}

export function formatPromptWithContext(session, prompt, context) {
  const promptContext = contextWithWorkspace(session, context);
  if (promptContext === undefined) {
    return prompt;
  }

  const lines = [];
  if (promptContext.workspaceRoot) {
    lines.push(`workspace_root: ${promptContext.workspaceRoot}`);
  }
  if (promptContext.activeTerminalCwd) {
    lines.push(`active_terminal_cwd: ${promptContext.activeTerminalCwd}`);
  }
  if (promptContext.activeFile) {
    lines.push(`active_file: ${promptContext.activeFile}`);
  }
  if (promptContext.activeTerminalPrivate) {
    lines.push("active_terminal_mode: private");
  }

  if (lines.length === 0) {
    return prompt;
  }
  return `<env>\n${lines.join("\n")}\n</env>\n\n${prompt}`;
}

function assertPromptWithinLimit(prompt) {
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new SessionProtocolError(
      RESOURCE_LIMIT,
      `sessions.send prompt must be at most ${MAX_PROMPT_CHARS} characters`,
    );
  }
}

function assertSessionCapacity() {
  if (sessions.size >= MAX_SESSIONS) {
    throw new SessionProtocolError(
      RESOURCE_LIMIT,
      `Pi host supports at most ${MAX_SESSIONS} sessions`,
    );
  }
}

function findSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session === undefined) {
    throw new SessionProtocolError(
      SESSION_NOT_FOUND,
      `Pi session not found: ${sessionId}`,
    );
  }
  return session;
}

function assertSendableSession(session) {
  if (session.status === "stopped") {
    throw new SessionProtocolError(
      SESSION_STOPPED,
      `Pi session is stopped: ${session.id}`,
    );
  }
  if (session.status === "running") {
    throw new SessionProtocolError(
      SESSION_BUSY,
      `Pi session is already running: ${session.id}`,
    );
  }
}

function disposeSession(session) {
  try {
    session.unsubscribe?.();
  } catch {
    // Best-effort cleanup only.
  }
  try {
    session.agentSession?.dispose?.();
  } catch {
    // Best-effort cleanup only.
  }
  try {
    session.cleanup?.();
  } catch {
    // Best-effort cleanup only.
  }
}

async function createTestFauxOptions(pi) {
  if (process.env.TERAX_PI_HOST_ENABLE_TEST_FAUX !== "1") {
    return { options: {}, cleanup: undefined };
  }

  const text = process.env.TERAX_PI_HOST_TEST_FAUX_RESPONSE;
  const toolCall = process.env.TERAX_PI_HOST_TEST_FAUX_TOOL_CALL;
  if (
    (typeof text !== "string" || text.length === 0) &&
    (typeof toolCall !== "string" || toolCall.length === 0)
  ) {
    return { options: {}, cleanup: undefined };
  }

  const ai = await import("@earendil-works/pi-ai");
  const tokensPerSecond = Number(
    process.env.TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND,
  );
  const fauxOptions =
    Number.isFinite(tokensPerSecond) && tokensPerSecond > 0
      ? { tokensPerSecond }
      : {};
  if (process.env.TERAX_PI_HOST_TEST_FAUX_REASONING === "true") {
    fauxOptions.models = [
      {
        id: "faux-1",
        name: "Faux Reasoning Model",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 16_384,
      },
    ];
  }
  const registration = ai.registerFauxProvider(fauxOptions);
  const finalText = typeof text === "string" && text.length > 0 ? text : "done";
  if (typeof toolCall === "string" && toolCall.length > 0) {
    let parsed;
    try {
      parsed = JSON.parse(toolCall);
    } catch {
      registration.unregister();
      throw new SessionProtocolError(
        INVALID_PARAMS,
        "TERAX_PI_HOST_TEST_FAUX_TOOL_CALL must be valid JSON",
      );
    }
    registration.setResponses([
      ai.fauxAssistantMessage([
        ai.fauxToolCall(parsed.name, parsed.arguments ?? {}, {
          id: parsed.id,
        }),
      ]),
      ai.fauxAssistantMessage([ai.fauxText(finalText)]),
    ]);
  } else {
    registration.setResponses([
      ai.fauxAssistantMessage([ai.fauxText(finalText)]),
    ]);
  }

  const authStorage =
    typeof pi.AuthStorage.inMemory === "function"
      ? pi.AuthStorage.inMemory()
      : pi.AuthStorage.create();
  authStorage.setRuntimeApiKey("faux", "terax-test-key");

  return {
    options: {
      model: registration.getModel(),
      authStorage,
      modelRegistry: pi.ModelRegistry.inMemory(authStorage),
    },
    cleanup: () => registration.unregister(),
  };
}

function outputPayload(session, text) {
  return session.activeBranch === undefined
    ? { text }
    : { text, branch: session.activeBranch };
}

function branchPayload(branch) {
  return {
    groupId: branch.groupId,
    index: branch.index,
    ...(branch.regeneratedFromEventId
      ? { regeneratedFromEventId: branch.regeneratedFromEventId }
      : {}),
  };
}

function createSessionBranch(session, regenerateBranchGroupId) {
  if (regenerateBranchGroupId === undefined) {
    return {
      groupId: createBranchGroupId(),
      index: 0,
    };
  }

  const group = session.branchGroups.get(regenerateBranchGroupId);
  if (!group) {
    // Legacy restored transcripts may synthesize their first branch group from
    // an older unbranched input event id; keep that regeneration path working.
    return {
      groupId: regenerateBranchGroupId,
      index: 1,
      regeneratedFromEventId: regenerateBranchGroupId,
    };
  }

  return {
    groupId: regenerateBranchGroupId,
    index: group.nextIndex,
    regeneratedFromEventId: group.lastInputEventId,
  };
}

function rememberSessionBranch(session, branch, inputEventId) {
  session.branchGroups.set(branch.groupId, {
    lastInputEventId: inputEventId,
    nextIndex: branch.index + 1,
  });
}

export function mapAgentSessionEvent(
  event,
  session,
  agentGeneration = session.agentGeneration,
) {
  if (session.status !== "running") {
    return null;
  }
  if (agentGeneration !== session.agentGeneration) {
    return null;
  }
  if (session.cancelledRunId === session.activeRunId) {
    return null;
  }

  switch (event.type) {
    case "agent_start":
      return publishEvent(
        "session.progress",
        session.id,
        outputPayload(session, "Starting Pi run…"),
      );
    case "turn_start":
      return publishEvent(
        "session.progress",
        session.id,
        outputPayload(session, "Preparing model request…"),
      );
    case "message_start":
      if (event.message?.role === "assistant") {
        return publishEvent(
          "session.progress",
          session.id,
          outputPayload(session, "Receiving response…"),
        );
      }
      return null;
    case "message_update": {
      const assistantEvent = event.assistantMessageEvent;
      if (assistantEvent?.type === "thinking_start") {
        return publishEvent(
          "session.progress",
          session.id,
          outputPayload(session, "Reasoning…"),
        );
      }
      if (assistantEvent?.type === "thinking_delta") {
        return publishEvent(
          "session.reasoning.delta",
          session.id,
          outputPayload(session, assistantEvent.delta),
        );
      }
      if (assistantEvent?.type === "thinking_end") {
        return publishEvent(
          "session.reasoning.text",
          session.id,
          outputPayload(session, assistantEvent.content),
        );
      }
      if (assistantEvent?.type === "text_start") {
        return publishEvent(
          "session.progress",
          session.id,
          outputPayload(session, "Writing response…"),
        );
      }
      if (assistantEvent?.type === "text_delta") {
        return publishEvent(
          "session.output.delta",
          session.id,
          outputPayload(session, assistantEvent.delta),
        );
      }
      if (assistantEvent?.type === "text_end") {
        return publishEvent(
          "session.output.text",
          session.id,
          outputPayload(session, assistantEvent.content),
        );
      }
      return null;
    }
    case "tool_execution_start":
      session.toolInputs.set(event.toolCallId, serializableValue(event.args));
      return publishEvent(
        "session.tool.start",
        session.id,
        toolPayload(session, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: serializableValue(event.args),
        }),
      );
    case "tool_execution_update":
      return publishEvent(
        "session.tool.update",
        session.id,
        toolPayload(session, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input:
            session.toolInputs.get(event.toolCallId) ??
            serializableValue(event.args),
          output: compactToolResult(event.partialResult),
        }),
      );
    case "tool_execution_end": {
      const input = session.toolInputs.get(event.toolCallId);
      session.toolInputs.delete(event.toolCallId);
      return publishEvent(
        "session.tool.result",
        session.id,
        toolPayload(session, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          ...(input === undefined ? {} : { input }),
          output: compactToolResult(event.result),
          errorText: event.isError ? toolResultText(event.result) : undefined,
          isError: event.isError === true,
        }),
      );
    }
    case "auto_retry_start":
      return publishEvent(
        "session.progress",
        session.id,
        outputPayload(
          session,
          `Retrying (${event.attempt}/${event.maxAttempts})…`,
        ),
      );
    case "compaction_start":
      return publishEvent(
        "session.progress",
        session.id,
        outputPayload(session, "Compacting context…"),
      );
  }

  return null;
}

async function attachAgentSession(session) {
  const pi = await import("@earendil-works/pi-coding-agent");
  const testFaux = await createTestFauxOptions(pi);
  const providerOptions = testFaux.cleanup
    ? {}
    : await createRuntimeProviderOptions(pi, session.providerConfig, {
        cwd: session.cwd,
      });
  const sessionOptions = { ...providerOptions, ...testFaux.options };
  const agentDir = sessionOptions.agentDir ?? pi.getAgentDir();
  const settingsManager =
    sessionOptions.settingsManager ??
    pi.SettingsManager.create(session.cwd, agentDir);
  const resourceLoader = new pi.DefaultResourceLoader({
    cwd: session.cwd,
    agentDir,
    settingsManager,
    extensionFactories: [createApprovalExtension(session)],
    noExtensions: true,
  });
  await resourceLoader.reload();
  const { session: agentSession } = await pi.createAgentSession({
    ...sessionOptions,
    cwd: session.cwd,
    agentDir,
    settingsManager,
    resourceLoader,
    customTools: createTeraxNativeToolDefinitions(pi, session),
    tools: ENABLED_TOOL_NAMES,
    sessionManager: createSdkSessionManager(pi, session),
  });
  session.agentSession = agentSession;
  session.sdkSessionFile = agentSession.sessionFile ?? session.sdkSessionFile;
  session.thinkingLevel = agentSession.thinkingLevel;
  const agentGeneration = session.agentGeneration + 1;
  session.agentGeneration = agentGeneration;
  session.cleanup = testFaux.cleanup;
  session.unsubscribe = agentSession.subscribe((event) => {
    mapAgentSessionEvent(event, session, agentGeneration);
  });
}

function createSdkSessionManager(pi, session) {
  if (session.sdkSessionFile) {
    return pi.SessionManager.open(
      session.sdkSessionFile,
      session.sessionDir,
      session.cwd,
    );
  }
  if (session.sessionDir) {
    return pi.SessionManager.create(session.cwd, session.sessionDir);
  }
  return pi.SessionManager.inMemory(session.cwd);
}

async function createAgentSessionRecord({
  id,
  title,
  cwd,
  createdAt,
  providerConfig,
  sessionDir,
  sdkSessionFile,
  autoTitle,
  lastPrompt = null,
  thinkingLevel = null,
  workspaceEnv = { kind: "local" },
}) {
  const session = {
    id,
    title,
    autoTitle,
    cwd,
    workspaceEnv,
    status: "idle",
    createdAt,
    updatedAt: createdAt,
    lastPrompt,
    sdkSessionFile: sdkSessionFile ?? null,
    sessionDir,
    agentSession: undefined,
    unsubscribe: undefined,
    cleanup: undefined,
    activeRunId: 0,
    cancelledRunId: null,
    agentGeneration: 0,
    activeBranch: undefined,
    branchGroups: new Map(),
    toolInputs: new Map(),
    pendingApprovals: new Map(),
    providerConfig,
    thinkingLevel,
  };
  await attachAgentSession(session);
  return session;
}
export async function resetSessionsForTests() {
  for (const session of sessions.values()) {
    session.status = "stopped";
    disposeSession(session);
  }
  nextSessionNumber = 1;
  nextEventNumber = 1;
  sessions.clear();
}

export function listSessions() {
  return {
    sessions: Array.from(sessions.values()).map(sessionSnapshot),
    events: [],
  };
}

export async function createSession(params) {
  const options = assertParamsObject(params, "sessions.create");
  assertSessionCapacity();
  const createdAt = isoNow();
  const displayNumber = nextSessionNumber;
  const id = createSessionId();
  nextSessionNumber += 1;
  const explicitTitle =
    typeof options.title === "string" && options.title.trim() !== ""
      ? options.title.trim()
      : null;
  const title = explicitTitle ?? `Pi Session ${displayNumber}`;
  const cwd =
    optionalString(options, "cwd", "sessions.create") ?? process.cwd();
  const sessionDir = optionalString(options, "sessionDir", "sessions.create");
  const workspaceEnv = normalizeWorkspaceEnv(
    options.workspaceEnv,
    "sessions.create",
  );
  const session = await createAgentSessionRecord({
    id,
    title,
    cwd,
    createdAt,
    providerConfig: options.providerConfig,
    sessionDir,
    workspaceEnv,
    autoTitle: explicitTitle === null,
  });
  sessions.set(id, session);

  const snapshot = sessionSnapshot(session);
  return {
    session: snapshot,
    events: [
      pushEvent("session.created", id, { session: snapshot }, createdAt),
    ],
  };
}

export async function resumeSession(params) {
  const options = assertParamsObject(params, "sessions.resume");
  const id = requiredString(options, "sessionId", "sessions.resume");
  const sdkSessionFile = requiredString(
    options,
    "sdkSessionFile",
    "sessions.resume",
  );
  const cwd = requiredString(options, "cwd", "sessions.resume");
  const sessionDir = optionalString(options, "sessionDir", "sessions.resume");
  const workspaceEnv = normalizeWorkspaceEnv(
    options.workspaceEnv,
    "sessions.resume",
  );
  const existing = sessions.get(id);
  if (existing) {
    return { session: sessionSnapshot(existing), events: [] };
  }
  assertSessionCapacity();
  const resumedAt = isoNow();
  const title =
    optionalString(options, "title", "sessions.resume") ?? "Pi Session";
  const createdAt =
    optionalContextString(options, "createdAt", "sessions.resume") ?? resumedAt;
  const lastPrompt =
    typeof options.lastPrompt === "string" ? options.lastPrompt : null;
  const thinkingLevel = optionalThinkingLevel(
    options,
    "thinkingLevel",
    "sessions.resume",
  );
  const session = await createAgentSessionRecord({
    id,
    title,
    cwd,
    createdAt,
    providerConfig: options.providerConfig,
    sessionDir,
    sdkSessionFile,
    workspaceEnv,
    autoTitle: false,
    lastPrompt,
    thinkingLevel: thinkingLevel ?? null,
  });
  session.updatedAt = resumedAt;
  sessions.set(id, session);

  const snapshot = sessionSnapshot(session);
  return {
    session: snapshot,
    events: [
      pushEvent(
        "session.resumed",
        id,
        {
          session: snapshot,
          sessionId: id,
          sdkSessionFile: snapshot.sdkSessionFile,
        },
        resumedAt,
      ),
    ],
  };
}

async function runPrompt(session, prompt, context, runId) {
  try {
    await session.agentSession.prompt(
      formatPromptWithContext(session, prompt, context),
    );
    if (
      session.status === "stopped" ||
      session.activeRunId !== runId ||
      session.cancelledRunId === runId
    ) {
      return;
    }
    const doneAt = isoNow();
    session.status = "idle";
    session.activeBranch = undefined;
    session.updatedAt = doneAt;
    publishEvent(
      "session.status",
      session.id,
      { status: session.status },
      doneAt,
    );
  } catch (error) {
    if (
      session.status === "stopped" ||
      session.activeRunId !== runId ||
      session.cancelledRunId === runId
    ) {
      return;
    }
    const failedAt = isoNow();
    const message = friendlySessionErrorMessage(error);
    resolveAllPendingApprovals(session, false, failedAt, "publish");
    session.status = "error";
    session.activeBranch = undefined;
    session.updatedAt = failedAt;
    publishEvent("session.error", session.id, { message }, failedAt);
    publishEvent(
      "session.status",
      session.id,
      { status: session.status },
      failedAt,
    );
  }
}

export async function sendToSession(params) {
  const options = assertParamsObject(params, "sessions.send");
  const sessionId = requiredString(options, "sessionId", "sessions.send");
  const prompt = requiredString(options, "prompt", "sessions.send");
  const context = normalizePromptContext(options.context, "sessions.send");
  const regenerateBranchGroupId = optionalContextString(
    options,
    "regenerateBranchGroupId",
    "sessions.send",
  );
  const thinkingLevel = optionalThinkingLevel(
    options,
    "thinkingLevel",
    "sessions.send",
  );
  assertPromptWithinLimit(prompt);
  const session = findSession(sessionId);
  assertSendableSession(session);
  setSessionThinkingLevel(session, thinkingLevel);
  const promptContext = contextWithWorkspace(session, context);
  const branch = createSessionBranch(session, regenerateBranchGroupId);
  const updatedAt = isoNow();

  const runId = session.activeRunId + 1;
  session.activeRunId = runId;
  session.cancelledRunId = null;
  session.activeBranch = branchPayload(branch);
  if (session.autoTitle && session.lastPrompt === null) {
    session.title = titleFromPrompt(prompt);
    session.autoTitle = false;
  }
  session.status = "running";
  session.updatedAt = updatedAt;
  session.lastPrompt = prompt;

  const inputPayload = {
    text: prompt,
    branch: session.activeBranch,
    ...(promptContext === undefined ? {} : { context: promptContext }),
    ...(thinkingLevel === undefined
      ? {}
      : { thinkingLevel: session.thinkingLevel }),
  };
  const inputEvent = pushEvent(
    "session.input",
    sessionId,
    inputPayload,
    updatedAt,
  );
  rememberSessionBranch(session, branch, inputEvent.id);

  const events = [
    inputEvent,
    pushEvent(
      "session.status",
      sessionId,
      { status: session.status },
      updatedAt,
    ),
  ];

  setImmediate(() => {
    void runPrompt(session, prompt, promptContext, runId);
  });

  return {
    accepted: true,
    session: sessionSnapshot(session),
    events,
  };
}

export async function respondToToolApproval(params) {
  const options = assertParamsObject(params, "sessions.tool.respond");
  const sessionId = requiredString(
    options,
    "sessionId",
    "sessions.tool.respond",
  );
  const toolCallId = requiredString(
    options,
    "toolCallId",
    "sessions.tool.respond",
  );
  if (typeof options.approved !== "boolean") {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      "sessions.tool.respond approved must be a boolean",
    );
  }

  const session = findSession(sessionId);
  const approval = session.pendingApprovals.get(toolCallId);
  if (!approval || approval.runId !== session.activeRunId) {
    throw new SessionProtocolError(
      APPROVAL_NOT_FOUND,
      `Pi tool approval not found: ${toolCallId}`,
    );
  }

  const updatedAt = isoNow();
  resolvePendingApproval(session, approval, options.approved);
  session.updatedAt = updatedAt;
  const event = pushToolApprovalResponded(
    session,
    approval,
    options.approved,
    updatedAt,
  );

  return {
    session: sessionSnapshot(session),
    events: [event],
  };
}

export async function renameSession(params) {
  const options = assertParamsObject(params, "sessions.rename");
  const sessionId = requiredString(options, "sessionId", "sessions.rename");
  const title = requiredString(options, "title", "sessions.rename");
  if (/\r|\n/.test(title)) {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      "sessions.rename title must not contain newlines",
    );
  }
  if (title.length > MAX_SESSION_TITLE_CHARS) {
    throw new SessionProtocolError(
      INVALID_PARAMS,
      `sessions.rename title must be at most ${MAX_SESSION_TITLE_CHARS} characters`,
    );
  }
  const session = findSession(sessionId);
  const updatedAt = isoNow();
  session.title = title;
  session.autoTitle = false;
  session.updatedAt = updatedAt;

  const snapshot = sessionSnapshot(session);
  return {
    session: snapshot,
    events: [pushEvent("session.renamed", sessionId, { title }, updatedAt)],
  };
}

export async function deleteSession(params) {
  const options = assertParamsObject(params, "sessions.delete");
  const sessionId = requiredString(options, "sessionId", "sessions.delete");
  const session = findSession(sessionId);
  const updatedAt = isoNow();
  const wasRunning = session.status === "running";
  const approvalEvents = resolveAllPendingApprovals(
    session,
    false,
    updatedAt,
    "push",
  );
  session.cancelledRunId = session.activeRunId;
  session.activeBranch = undefined;
  session.status = "stopped";
  session.updatedAt = updatedAt;
  if (wasRunning) {
    try {
      await session.agentSession.abort();
    } catch {
      // Best-effort cleanup only.
    }
  }
  disposeSession(session);
  sessions.delete(sessionId);

  return {
    events: [
      ...approvalEvents,
      pushEvent("session.deleted", sessionId, { sessionId }, updatedAt),
    ],
  };
}

export async function stopSession(params) {
  const options = assertParamsObject(params, "sessions.stop");
  const sessionId = requiredString(options, "sessionId", "sessions.stop");
  const session = findSession(sessionId);
  const updatedAt = isoNow();
  const approvalEvents = resolveAllPendingApprovals(
    session,
    false,
    updatedAt,
    "push",
  );
  if (session.status === "running") {
    session.cancelledRunId = session.activeRunId;
    try {
      await session.agentSession.abort();
    } finally {
      disposeSession(session);
    }
    await attachAgentSession(session);
    session.activeBranch = undefined;
    session.status = "idle";
  } else {
    disposeSession(session);
    session.activeBranch = undefined;
    session.status = "stopped";
  }
  session.updatedAt = updatedAt;

  const snapshot = sessionSnapshot(session);
  return {
    session: snapshot,
    events: [
      ...approvalEvents,
      pushEvent(
        "session.status",
        sessionId,
        { status: session.status },
        updatedAt,
      ),
    ],
  };
}
