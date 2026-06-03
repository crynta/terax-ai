import { randomUUID } from "node:crypto";
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

function sessionSnapshot(session) {
  const {
    agentSession: _agentSession,
    unsubscribe: _unsubscribe,
    cleanup: _cleanup,
    activeRunId: _activeRunId,
    cancelledRunId: _cancelledRunId,
    providerConfig: _providerConfig,
    autoTitle: _autoTitle,
    agentGeneration: _agentGeneration,
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
  const text = process.env.TERAX_PI_HOST_TEST_FAUX_RESPONSE;
  if (typeof text !== "string" || text.length === 0) {
    return { options: {}, cleanup: undefined };
  }

  const ai = await import("@earendil-works/pi-ai");
  const tokensPerSecond = Number(
    process.env.TERAX_PI_HOST_TEST_FAUX_TOKENS_PER_SECOND,
  );
  const registration = ai.registerFauxProvider(
    Number.isFinite(tokensPerSecond) && tokensPerSecond > 0
      ? { tokensPerSecond }
      : undefined,
  );
  registration.setResponses([ai.fauxAssistantMessage([ai.fauxText(text)])]);

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

export function mapAgentSessionEvent(
  event,
  session,
  agentGeneration = session.agentGeneration,
) {
  if (event.type !== "message_update") {
    return null;
  }
  if (session.status !== "running") {
    return null;
  }
  if (agentGeneration !== session.agentGeneration) {
    return null;
  }
  if (session.cancelledRunId === session.activeRunId) {
    return null;
  }

  if (event.assistantMessageEvent?.type === "text_delta") {
    return publishEvent("session.output.delta", session.id, {
      text: event.assistantMessageEvent.delta,
    });
  }

  if (event.assistantMessageEvent?.type === "text_end") {
    return publishEvent("session.output.text", session.id, {
      text: event.assistantMessageEvent.content,
    });
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
  const { session: agentSession } = await pi.createAgentSession({
    ...providerOptions,
    ...testFaux.options,
    cwd: session.cwd,
    noTools: "all",
    sessionManager: pi.SessionManager.inMemory(),
  });
  const agentGeneration = session.agentGeneration + 1;
  session.agentGeneration = agentGeneration;
  session.agentSession = agentSession;
  session.cleanup = testFaux.cleanup;
  session.unsubscribe = agentSession.subscribe((event) => {
    mapAgentSessionEvent(event, session, agentGeneration);
  });
}

async function createAgentSessionRecord({
  id,
  title,
  cwd,
  createdAt,
  providerConfig,
  autoTitle,
}) {
  const session = {
    id,
    title,
    autoTitle,
    cwd,
    status: "idle",
    createdAt,
    updatedAt: createdAt,
    lastPrompt: null,
    agentSession: undefined,
    unsubscribe: undefined,
    cleanup: undefined,
    activeRunId: 0,
    cancelledRunId: null,
    agentGeneration: 0,
    providerConfig,
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
  const session = await createAgentSessionRecord({
    id,
    title,
    cwd,
    createdAt,
    providerConfig: options.providerConfig,
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
    session.status = "error";
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
  assertPromptWithinLimit(prompt);
  const session = findSession(sessionId);
  assertSendableSession(session);
  const promptContext = contextWithWorkspace(session, context);
  const updatedAt = isoNow();

  const runId = session.activeRunId + 1;
  session.activeRunId = runId;
  session.cancelledRunId = null;
  if (session.autoTitle && session.lastPrompt === null) {
    session.title = titleFromPrompt(prompt);
    session.autoTitle = false;
  }
  session.status = "running";
  session.updatedAt = updatedAt;
  session.lastPrompt = prompt;

  const events = [
    pushEvent(
      "session.input",
      sessionId,
      promptContext === undefined
        ? { text: prompt }
        : { text: prompt, context: promptContext },
      updatedAt,
    ),
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

export async function stopSession(params) {
  const options = assertParamsObject(params, "sessions.stop");
  const sessionId = requiredString(options, "sessionId", "sessions.stop");
  const session = findSession(sessionId);
  const updatedAt = isoNow();

  if (session.status === "running") {
    session.cancelledRunId = session.activeRunId;
    try {
      await session.agentSession.abort();
    } finally {
      disposeSession(session);
    }
    await attachAgentSession(session);
    session.status = "idle";
  } else {
    disposeSession(session);
    session.status = "stopped";
  }
  session.updatedAt = updatedAt;

  const snapshot = sessionSnapshot(session);
  return {
    session: snapshot,
    events: [
      pushEvent(
        "session.status",
        sessionId,
        { status: session.status },
        updatedAt,
      ),
    ],
  };
}
