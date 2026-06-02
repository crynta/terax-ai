export class SessionProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SessionProtocolError";
    this.code = code;
  }
}

const INVALID_PARAMS = -32602;
const SESSION_NOT_FOUND = -32004;
const SESSION_STOPPED = -32005;
const RESOURCE_LIMIT = -32006;
const SESSION_BUSY = -32007;
const MAX_SESSIONS = 20;
const MAX_PROMPT_CHARS = 20_000;

let nextSessionNumber = 1;
let nextEventNumber = 1;
let sessionEventSink = () => {};
const sessions = new Map();

function isoNow() {
  return new Date().toISOString();
}

function sessionSnapshot(session) {
  const {
    agentSession: _agentSession,
    unsubscribe: _unsubscribe,
    cleanup: _cleanup,
    ...snapshot
  } = session;
  return { ...snapshot };
}

function sessionEvent(type, sessionId, payload, createdAt = isoNow()) {
  return {
    id: `evt-${nextEventNumber}`,
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

function mapAgentSessionEvent(event, sessionId) {
  if (event.type !== "message_update") {
    return null;
  }

  if (event.assistantMessageEvent?.type === "text_delta") {
    return publishEvent("session.output.delta", sessionId, {
      text: event.assistantMessageEvent.delta,
    });
  }

  if (event.assistantMessageEvent?.type === "text_end") {
    return publishEvent("session.output.text", sessionId, {
      text: event.assistantMessageEvent.content,
    });
  }

  return null;
}

async function createAgentSessionRecord({ id, title, cwd, createdAt }) {
  const pi = await import("@earendil-works/pi-coding-agent");
  const testFaux = await createTestFauxOptions(pi);
  const { session: agentSession } = await pi.createAgentSession({
    ...testFaux.options,
    cwd,
    noTools: "all",
    sessionManager: pi.SessionManager.inMemory(),
  });
  const unsubscribe = agentSession.subscribe((event) => {
    mapAgentSessionEvent(event, id);
  });

  return {
    id,
    title,
    cwd,
    status: "idle",
    createdAt,
    updatedAt: createdAt,
    lastPrompt: null,
    agentSession,
    unsubscribe,
    cleanup: testFaux.cleanup,
  };
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
  const id = `pi-${nextSessionNumber}`;
  nextSessionNumber += 1;
  const title =
    typeof options.title === "string" && options.title.trim() !== ""
      ? options.title.trim()
      : `Pi Session ${id.replace("pi-", "")}`;
  const cwd =
    optionalString(options, "cwd", "sessions.create") ?? process.cwd();
  const session = await createAgentSessionRecord({ id, title, cwd, createdAt });
  sessions.set(id, session);

  const snapshot = sessionSnapshot(session);
  return {
    session: snapshot,
    events: [
      pushEvent("session.created", id, { session: snapshot }, createdAt),
    ],
  };
}

async function runPrompt(session, prompt) {
  try {
    await session.agentSession.prompt(prompt);
    if (session.status === "stopped") {
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
    if (session.status === "stopped") {
      return;
    }
    const failedAt = isoNow();
    const message = error instanceof Error ? error.message : String(error);
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
  assertPromptWithinLimit(prompt);
  const session = findSession(sessionId);
  assertSendableSession(session);
  const updatedAt = isoNow();

  session.status = "running";
  session.updatedAt = updatedAt;
  session.lastPrompt = prompt;

  const events = [
    pushEvent("session.input", sessionId, { text: prompt }, updatedAt),
    pushEvent(
      "session.status",
      sessionId,
      { status: session.status },
      updatedAt,
    ),
  ];

  setImmediate(() => {
    void runPrompt(session, prompt);
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
    await session.agentSession.abort();
  }
  disposeSession(session);
  session.status = "stopped";
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
