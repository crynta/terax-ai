export class SessionProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SessionProtocolError";
    this.code = code;
  }
}

const INVALID_PARAMS = -32602;
const SESSION_NOT_FOUND = -32004;

let nextSessionNumber = 1;
let nextEventNumber = 1;
const sessions = new Map();

function isoNow() {
  return new Date().toISOString();
}

function sessionSnapshot(session) {
  return { ...session };
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

export function resetSessionsForTests() {
  nextSessionNumber = 1;
  nextEventNumber = 1;
  sessions.clear();
}

export function listSessions() {
  return {
    sessions: Array.from(sessions.values()).map(sessionSnapshot),
  };
}

export function createSession(params) {
  const options = assertParamsObject(params, "sessions.create");
  const createdAt = isoNow();
  const id = `pi-${nextSessionNumber}`;
  nextSessionNumber += 1;
  const title =
    typeof options.title === "string" && options.title.trim() !== ""
      ? options.title.trim()
      : `Pi Session ${id.replace("pi-", "")}`;
  const session = {
    id,
    title,
    status: "idle",
    createdAt,
    updatedAt: createdAt,
    lastPrompt: null,
  };
  sessions.set(id, session);

  const snapshot = sessionSnapshot(session);
  return {
    session: snapshot,
    events: [
      pushEvent("session.created", id, { session: snapshot }, createdAt),
    ],
  };
}

export function sendToSession(params) {
  const options = assertParamsObject(params, "sessions.send");
  const sessionId = requiredString(options, "sessionId", "sessions.send");
  const prompt = requiredString(options, "prompt", "sessions.send");
  const session = findSession(sessionId);
  const updatedAt = isoNow();

  session.status = "running";
  session.updatedAt = updatedAt;
  session.lastPrompt = prompt;

  const snapshot = sessionSnapshot(session);
  return {
    accepted: true,
    session: snapshot,
    events: [
      pushEvent("session.input", sessionId, { text: prompt }, updatedAt),
      pushEvent(
        "session.status",
        sessionId,
        { status: session.status },
        updatedAt,
      ),
    ],
  };
}

export function stopSession(params) {
  const options = assertParamsObject(params, "sessions.stop");
  const sessionId = requiredString(options, "sessionId", "sessions.stop");
  const session = findSession(sessionId);
  const updatedAt = isoNow();

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
