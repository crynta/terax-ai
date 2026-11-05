import type {
  Agent,
  AgentHookEvent,
  AgentModelEvent,
  AgentRegistry,
  AgentSignalEvent,
  AgentState,
  CurrentTool,
  HookEventKind,
  Provenance,
  ToolInfo,
  WaitingReason,
} from "./types";

export const emptyRegistry: AgentRegistry = {};

const NEEDS_YOU: ReadonlySet<AgentState> = new Set([
  "needs-approval",
  "needs-input",
  "error",
  "done",
]);

/** The agent is mid-run, so tool activity says it is working. */
const ACTIVE: ReadonlySet<AgentState> = new Set([
  "starting",
  "working",
  "needs-approval",
  "needs-input",
]);

/** Hooks that prove an agent is running, even before a process signal. */
const CREATES: ReadonlySet<HookEventKind> = new Set([
  "session-start",
  "prompt",
  "permission-request",
  "notification",
  "stop",
  "stop-failure",
]);

/** Hooks that start a fresh run in a terminal whose agent already exited. */
const REVIVES: ReadonlySet<HookEventKind> = new Set([
  "session-start",
  "prompt",
  "permission-request",
  "stop",
  "stop-failure",
]);

const INFORMATIONAL_NOTIFICATIONS: ReadonlySet<string> = new Set([
  "auth_success",
  "elicitation_complete",
  "elicitation_response",
  "agent_completed",
  "quota_auto_resume_fired",
  "quota_auto_resume_stale",
  "quota_auto_resume_disabled",
  "plugin_notification",
]);

type Effect = { state: AgentState; reason: WaitingReason };

/** What a notification asks of the user, or null when it is only information. */
export function notificationEffect(type: string | undefined): Effect | null {
  switch (type) {
    case "permission_prompt":
    case "ToolPermission":
      return { state: "needs-approval", reason: "permission" };
    case "idle_prompt":
      return { state: "needs-input", reason: "idle" };
    case "elicitation_dialog":
    case "elicitation_url_dialog":
      return { state: "needs-input", reason: "elicitation" };
    case "agent_needs_input":
      return { state: "needs-input", reason: "input" };
    default:
      if (type !== undefined && INFORMATIONAL_NOTIFICATIONS.has(type)) {
        return null;
      }
      return { state: "needs-input", reason: "attention" };
  }
}

export function needsYou(state: AgentState): boolean {
  return NEEDS_YOU.has(state);
}

const PROVENANCE_RANK: Record<Provenance, number> = {
  process: 0,
  osc: 1,
  hook: 2,
};

function strongest(a: Provenance, b: Provenance): Provenance {
  return PROVENANCE_RANK[a] >= PROVENANCE_RANK[b] ? a : b;
}

function create(
  ptyId: number,
  paneId: number | null,
  agent: string,
  provenance: Provenance,
  state: AgentState,
  at: number,
): Agent {
  return {
    ptyId,
    paneId,
    agent,
    state,
    waitingReason: null,
    sessionId: null,
    transcriptPath: null,
    cwd: null,
    lastMessage: null,
    lastPrompt: null,
    currentTool: null,
    runningTools: {},
    subagents: {},
    pendingPermission: null,
    turn: 0,
    provenance,
    startedAt: at,
    updatedAt: at,
    stateSince: at,
    attentionSince: null,
  };
}

function setState(
  agent: Agent,
  state: AgentState,
  reason: WaitingReason | null,
  at: number,
): Agent {
  return {
    ...agent,
    state,
    waitingReason: reason,
    stateSince: agent.state === state ? agent.stateSince : at,
    attentionSince: NEEDS_YOU.has(state) ? (agent.attentionSince ?? at) : null,
    updatedAt: at,
  };
}

function quiet(agent: Agent): Agent {
  return {
    ...agent,
    currentTool: null,
    runningTools: {},
    pendingPermission: null,
    subagents: {},
  };
}

function toolKey(tool: ToolInfo): string {
  return tool.id ?? `${tool.name}\u0000${tool.inputPreview}`;
}

/** The running entry a tool end belongs to, matching by id and then by call. */
function runningKey(
  running: Readonly<Record<string, CurrentTool>>,
  tool: ToolInfo,
): string | null {
  const direct = toolKey(tool);
  if (direct in running) return direct;
  const match = Object.entries(running).find(
    ([, entry]) =>
      entry.name === tool.name && entry.inputPreview === tool.inputPreview,
  );
  return match ? match[0] : null;
}

function latest(
  running: Readonly<Record<string, CurrentTool>>,
): CurrentTool | null {
  let best: CurrentTool | null = null;
  for (const entry of Object.values(running)) {
    if (!best || entry.startedAt >= best.startedAt) best = entry;
  }
  return best;
}

function put(registry: AgentRegistry, agent: Agent): AgentRegistry {
  return { ...registry, [agent.ptyId]: agent };
}

export function reduceAgents(
  registry: AgentRegistry,
  event: AgentModelEvent,
): AgentRegistry {
  switch (event.type) {
    case "hook":
      return reduceHook(registry, event.event);
    case "signal":
      return reduceSignal(registry, event.signal, event.at);
    case "acknowledge": {
      const agent = registry[event.ptyId];
      if (!agent || (agent.state !== "done" && agent.state !== "error")) {
        return registry;
      }
      return put(registry, setState(agent, "idle", null, event.at));
    }
    case "remove": {
      if (!(event.ptyId in registry)) return registry;
      const next = { ...registry };
      delete next[event.ptyId];
      return next;
    }
  }
}

function reduceSignal(
  registry: AgentRegistry,
  signal: AgentSignalEvent,
  at: number,
): AgentRegistry {
  const current = registry[signal.id];
  switch (signal.kind) {
    case "started": {
      if (current && current.state !== "exited") {
        const name = signal.agent;
        return name && current.agent === "agent"
          ? put(registry, { ...current, agent: name })
          : registry;
      }
      return put(
        registry,
        create(
          signal.id,
          current?.paneId ?? null,
          signal.agent ?? "agent",
          "process",
          "starting",
          at,
        ),
      );
    }
    case "exited": {
      if (!current || current.state === "exited") return registry;
      const exited = setState(quiet(current), "exited", null, at);
      return put(registry, exited);
    }
    case "working":
    case "attention":
    case "finished": {
      // A hooked agent reports its own state; OSC hints would only repeat it.
      if (!current || current.state === "exited") return registry;
      if (current.provenance === "hook") return registry;
      const provenance = strongest(current.provenance, "osc");
      let next: Agent;
      if (signal.kind === "working") {
        next = setState(current, "working", null, at);
      } else if (signal.kind === "attention") {
        next = setState(current, "needs-input", "attention", at);
      } else {
        next = setState(quiet(current), "done", null, at);
      }
      return put(registry, { ...next, provenance });
    }
  }
}

function reduceHook(
  registry: AgentRegistry,
  event: AgentHookEvent,
): AgentRegistry {
  const existing = registry[event.ptyId];
  let agent: Agent;
  if (!existing || existing.state === "exited") {
    const allowed = existing
      ? REVIVES.has(event.kind)
      : CREATES.has(event.kind);
    if (!allowed) return registry;
    agent = create(
      event.ptyId,
      event.paneId,
      event.agent,
      "hook",
      "idle",
      event.at,
    );
  } else {
    agent = existing;
  }

  const base: Agent = {
    ...agent,
    paneId: event.paneId,
    agent: event.agent,
    provenance: "hook",
    sessionId: event.sessionId ?? agent.sessionId,
    transcriptPath: event.transcriptPath ?? agent.transcriptPath,
    cwd: event.cwd ?? agent.cwd,
    updatedAt: event.at,
  };
  return put(registry, applyHook(base, event));
}

function applyHook(agent: Agent, event: AgentHookEvent): Agent {
  const at = event.at;
  switch (event.kind) {
    case "session-start": {
      if (event.reason === "compact") return agent;
      const fresh = quiet(agent);
      return setState(
        { ...fresh, turn: 0, lastPrompt: null },
        "idle",
        null,
        at,
      );
    }
    case "prompt":
      return setState(
        {
          ...quiet(agent),
          turn: agent.turn + 1,
          lastPrompt: event.message ?? agent.lastPrompt,
        },
        "working",
        null,
        at,
      );
    case "tool-start": {
      const tool = event.tool;
      if (!tool || !ACTIVE.has(agent.state)) return agent;
      const entry: CurrentTool = {
        id: tool.id ?? null,
        name: tool.name,
        inputPreview: tool.inputPreview,
        startedAt: at,
      };
      const next: Agent = {
        ...agent,
        runningTools: { ...agent.runningTools, [toolKey(tool)]: entry },
        currentTool: entry,
      };
      // Background hooks race the synchronous permission hook and parallel
      // tools run while another waits, so a start never means an approval was
      // answered.
      return agent.state === "needs-approval"
        ? next
        : setState(next, "working", null, at);
    }
    case "tool-end": {
      const tool = event.tool;
      const key = tool ? runningKey(agent.runningTools, tool) : null;
      let runningTools = agent.runningTools;
      if (key !== null) {
        const { [key]: _ended, ...rest } = runningTools;
        runningTools = rest;
      }
      const next: Agent = {
        ...agent,
        runningTools,
        currentTool: latest(runningTools),
      };
      const pending = agent.pendingPermission;
      const answered =
        pending !== null &&
        tool !== undefined &&
        pending.tool === tool.name &&
        pending.inputPreview === tool.inputPreview;
      return answered
        ? setState({ ...next, pendingPermission: null }, "working", null, at)
        : next;
    }
    case "permission-request": {
      const permission = event.permission;
      const next: Agent = {
        ...agent,
        lastMessage: event.message ?? agent.lastMessage,
        pendingPermission: permission
          ? {
              requestId: permission.requestId ?? null,
              tool: permission.tool,
              inputPreview: permission.inputPreview,
              suggestions: permission.suggestions ?? [],
              at,
            }
          : null,
      };
      return setState(next, "needs-approval", "permission", at);
    }
    case "permission-resolved": {
      const pending = agent.pendingPermission;
      const id = event.permission?.requestId;
      if (!pending || (id !== undefined && pending.requestId !== id)) {
        return agent;
      }
      const cleared = { ...agent, pendingPermission: null };
      // The agent dropping the hook means the user answered at its own prompt.
      const outcome = event.permission?.outcome;
      return outcome === "allow" ||
        outcome === "deny" ||
        outcome === "agent-gone"
        ? setState(cleared, "working", null, at)
        : cleared;
    }
    case "notification": {
      const withMessage = {
        ...agent,
        lastMessage: event.message ?? agent.lastMessage,
      };
      const effect = notificationEffect(event.notificationType);
      if (!effect) return withMessage;
      if (effect.state === "needs-approval") {
        return agent.state === "needs-approval"
          ? withMessage
          : setState(withMessage, "needs-approval", effect.reason, at);
      }
      const settled =
        agent.state === "done" ||
        agent.state === "error" ||
        agent.state === "needs-approval";
      return settled
        ? withMessage
        : setState(withMessage, "needs-input", effect.reason, at);
    }
    case "stop": {
      const next = {
        ...quiet(agent),
        lastMessage: event.message ?? agent.lastMessage,
      };
      return event.reason === "aborted"
        ? setState(next, "idle", null, at)
        : setState(next, "done", null, at);
    }
    case "stop-failure":
      return setState(
        {
          ...quiet(agent),
          lastMessage: event.message ?? agent.lastMessage,
        },
        "error",
        "error",
        at,
      );
    case "interrupt":
      return setState(quiet(agent), "idle", null, at);
    case "subagent-start": {
      const subagent = event.subagent;
      if (!subagent) return agent;
      return {
        ...agent,
        subagents: {
          ...agent.subagents,
          [subagent.id]: {
            id: subagent.id,
            type: subagent.type,
            state: "running",
            startedAt: at,
            endedAt: null,
            message: null,
          },
        },
      };
    }
    case "subagent-stop": {
      const subagent = event.subagent;
      if (!subagent) return agent;
      const previous = agent.subagents[subagent.id];
      return {
        ...agent,
        subagents: {
          ...agent.subagents,
          [subagent.id]: {
            id: subagent.id,
            type: subagent.type,
            state: "done",
            startedAt: previous?.startedAt ?? at,
            endedAt: at,
            message: event.message ?? previous?.message ?? null,
          },
        },
      };
    }
    case "session-end":
      return setState(quiet(agent), "idle", null, at);
  }
}
