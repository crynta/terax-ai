import { createTeraxNativeToolDefinitions } from "./native-tools.js";
import {
  createApprovalExtension,
  pushToolApprovalResponded,
  resolveAllPendingApprovals,
  resolvePendingApproval,
} from "./session-approvals.js";
import { createRuntimeProviderOptions } from "./provider-config.js";
import {
  createBranchGroupId,
  createSessionId,
  isoNow,
  SESSION_EVENT,
  publishEvent,
  pushEvent,
  resetSessionEventsForTests,
  sessionSnapshot,
  setSessionEventSink,
} from "./session-events.js";
export { setSessionEventSink } from "./session-events.js";
import {
  INVALID_PARAMS,
  assertParamsObject,
  assertResumeSessionFile,
  normalizePromptContext,
  normalizeWorkspaceEnv,
  optionalContextString,
  optionalString,
  optionalThinkingLevel,
  requiredString,
  titleFromPrompt,
  compactContext,
} from "./session-params.js";
import { branchPayload } from "./session-payloads.js";
import { mapAgentSessionEvent } from "./session-event-mapper.js";
export { mapAgentSessionEvent } from "./session-event-mapper.js";
import { enabledToolNamesForSession } from "./tool-policy.js";
export {
  APPROVAL_TOOL_NAMES,
  ENABLED_TOOL_NAMES,
  TOOL_MODE,
  approvalToolNamesForSession,
  enabledToolNamesForSession,
  toolRequiresApproval,
  validateToolSafety,
} from "./tool-policy.js";
import {
  friendlySessionErrorMessage,
  SessionProtocolError,
} from "./session-errors.js";

export { SessionProtocolError } from "./session-errors.js";

const SESSION_NOT_FOUND = -32004;
const SESSION_STOPPED = -32005;
const RESOURCE_LIMIT = -32006;
const SESSION_BUSY = -32007;
const APPROVAL_NOT_FOUND = -32008;
export const MAX_SESSIONS = 20;
export const MAX_PROMPT_CHARS = 20_000;
export const MAX_SESSION_TITLE_CHARS = 256;

let nextSessionNumber = 1;
const sessions = new Map();

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
  } catch {}
  try {
    session.agentSession?.dispose?.();
  } catch {}
  try {
    session.cleanup?.();
  } catch {}
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
    tools: enabledToolNamesForSession(session),
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
  capabilityManifest = null,
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
    capabilityManifest,
  };
  await attachAgentSession(session);
  return session;
}
export async function resetSessionsForTests() {
  for (const session of sessions.values()) {
    session.cancelledRunId = session.activeRunId;
    resolveAllPendingApprovals(session, false, isoNow(), "push");
    if (session.status === "running") {
      try {
        await session.agentSession?.abort?.();
      } catch {}
    }
    session.status = "stopped";
    disposeSession(session);
  }
  nextSessionNumber = 1;
  resetSessionEventsForTests();
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
    capabilityManifest: options.capabilityManifest ?? null,
    autoTitle: explicitTitle === null,
  });
  sessions.set(id, session);

  const snapshot = sessionSnapshot(session);
  return {
    session: snapshot,
    events: [
      pushEvent(SESSION_EVENT.Created, id, { session: snapshot }, createdAt),
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
  const sessionDir = requiredString(options, "sessionDir", "sessions.resume");
  await assertResumeSessionFile(sdkSessionFile, sessionDir);
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
    capabilityManifest: options.capabilityManifest ?? null,
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
        SESSION_EVENT.Resumed,
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
      SESSION_EVENT.Status,
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
    publishEvent(SESSION_EVENT.Error, session.id, { message }, failedAt);
    publishEvent(
      SESSION_EVENT.Status,
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
  };
  if (promptContext !== undefined) inputPayload.context = promptContext;
  if (thinkingLevel !== undefined) {
    inputPayload.thinkingLevel = session.thinkingLevel;
  }
  const inputEvent = pushEvent(
    SESSION_EVENT.Input,
    sessionId,
    inputPayload,
    updatedAt,
  );
  rememberSessionBranch(session, branch, inputEvent.id);

  const events = [
    inputEvent,
    pushEvent(
      SESSION_EVENT.Status,
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
    events: [pushEvent(SESSION_EVENT.Renamed, sessionId, { title }, updatedAt)],
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
    } catch {}
  }
  disposeSession(session);
  sessions.delete(sessionId);

  return {
    events: [
      ...approvalEvents,
      pushEvent(SESSION_EVENT.Deleted, sessionId, { sessionId }, updatedAt),
    ],
  };
}

export async function stopSession(params) {
  const options = assertParamsObject(params, "sessions.stop");
  const sessionId = requiredString(options, "sessionId", "sessions.stop");
  const session = findSession(sessionId);
  const updatedAt = isoNow();
  if (session.status === "stopped") {
    session.updatedAt = updatedAt;
    const snapshot = sessionSnapshot(session);
    return {
      session: snapshot,
      events: [
        pushEvent(
          SESSION_EVENT.Status,
          sessionId,
          { status: session.status },
          updatedAt,
        ),
      ],
    };
  }
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
        SESSION_EVENT.Status,
        sessionId,
        { status: session.status },
        updatedAt,
      ),
    ],
  };
}
