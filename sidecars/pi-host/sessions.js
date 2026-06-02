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

let nextSessionNumber = 1;
let nextEventNumber = 1;
const sessions = new Map();

function isoNow() {
  return new Date().toISOString();
}

function sessionSnapshot(session) {
  const {
    agentSession: _agentSession,
    unsubscribe: _unsubscribe,
    cleanup: _cleanup,
    liveEvents: _liveEvents,
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
  const registration = ai.registerFauxProvider();
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
  if (
    event.type !== "message_update" ||
    event.assistantMessageEvent?.type !== "text_delta"
  ) {
    return null;
  }

  return pushEvent("session.output.delta", sessionId, {
    text: event.assistantMessageEvent.delta,
  });
}

async function createAgentSessionRecord({ id, title, createdAt }) {
  const pi = await import("@earendil-works/pi-coding-agent");
  const testFaux = await createTestFauxOptions(pi);
  const { session: agentSession } = await pi.createAgentSession({
    ...testFaux.options,
    noTools: "all",
    sessionManager: pi.SessionManager.inMemory(),
  });
  const liveEvents = [];
  const unsubscribe = agentSession.subscribe((event) => {
    const mapped = mapAgentSessionEvent(event, id);
    if (mapped !== null) {
      liveEvents.push(mapped);
    }
  });

  return {
    id,
    title,
    status: "idle",
    createdAt,
    updatedAt: createdAt,
    lastPrompt: null,
    agentSession,
    unsubscribe,
    cleanup: testFaux.cleanup,
    liveEvents,
  };
}

export async function resetSessionsForTests() {
  for (const session of sessions.values()) {
    disposeSession(session);
  }
  nextSessionNumber = 1;
  nextEventNumber = 1;
  sessions.clear();
}

export function listSessions() {
  return {
    sessions: Array.from(sessions.values()).map(sessionSnapshot),
  };
}

export async function createSession(params) {
  const options = assertParamsObject(params, "sessions.create");
  const createdAt = isoNow();
  const id = `pi-${nextSessionNumber}`;
  nextSessionNumber += 1;
  const title =
    typeof options.title === "string" && options.title.trim() !== ""
      ? options.title.trim()
      : `Pi Session ${id.replace("pi-", "")}`;
  const session = await createAgentSessionRecord({ id, title, createdAt });
  sessions.set(id, session);

  const snapshot = sessionSnapshot(session);
  return {
    session: snapshot,
    events: [
      pushEvent("session.created", id, { session: snapshot }, createdAt),
    ],
  };
}

export async function sendToSession(params) {
  const options = assertParamsObject(params, "sessions.send");
  const sessionId = requiredString(options, "sessionId", "sessions.send");
  const prompt = requiredString(options, "prompt", "sessions.send");
  const session = findSession(sessionId);
  assertSendableSession(session);
  const updatedAt = isoNow();

  session.status = "running";
  session.updatedAt = updatedAt;
  session.lastPrompt = prompt;
  session.liveEvents.length = 0;

  const events = [
    pushEvent("session.input", sessionId, { text: prompt }, updatedAt),
    pushEvent(
      "session.status",
      sessionId,
      { status: session.status },
      updatedAt,
    ),
  ];

  try {
    await session.agentSession.prompt(prompt);
    const doneAt = isoNow();
    session.status = "idle";
    session.updatedAt = doneAt;
    events.push(...session.liveEvents);
    events.push(
      pushEvent(
        "session.status",
        sessionId,
        { status: session.status },
        doneAt,
      ),
    );
    return {
      accepted: true,
      session: sessionSnapshot(session),
      events,
    };
  } catch (error) {
    const failedAt = isoNow();
    const message = error instanceof Error ? error.message : String(error);
    session.status = "error";
    session.updatedAt = failedAt;
    events.push(...session.liveEvents);
    events.push(pushEvent("session.error", sessionId, { message }, failedAt));
    events.push(
      pushEvent(
        "session.status",
        sessionId,
        { status: session.status },
        failedAt,
      ),
    );
    return {
      accepted: false,
      session: sessionSnapshot(session),
      events,
    };
  } finally {
    session.liveEvents.length = 0;
  }
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
