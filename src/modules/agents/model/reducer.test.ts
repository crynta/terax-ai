import { describe, expect, it } from "vitest";
import { emptyRegistry, notificationEffect, reduceAgents } from "./reducer";
import type {
  Agent,
  AgentHookEvent,
  AgentModelEvent,
  AgentRegistry,
  AgentSignalKind,
  AgentState,
  HookEventKind,
} from "./types";

const PTY = 4;

let clock = 1000;
function tick(): number {
  clock += 10;
  return clock;
}

function hook(
  kind: HookEventKind,
  extra: Partial<AgentHookEvent> = {},
): AgentModelEvent {
  return {
    type: "hook",
    event: {
      paneId: 2,
      ptyId: PTY,
      agent: "claude",
      kind,
      at: tick(),
      ...extra,
    },
  };
}

function signal(kind: AgentSignalKind, agent?: string): AgentModelEvent {
  return { type: "signal", signal: { id: PTY, kind, agent }, at: tick() };
}

function run(...events: AgentModelEvent[]): AgentRegistry {
  return events.reduce(reduceAgents, emptyRegistry);
}

function agentOf(registry: AgentRegistry): Agent {
  const agent = registry[PTY];
  if (!agent) throw new Error("agent missing");
  return agent;
}

function stateAfter(...events: AgentModelEvent[]): AgentState {
  return agentOf(run(...events)).state;
}

const permission = (requestId?: string) => ({
  requestId,
  tool: "Bash",
  inputPreview: "npm test",
  suggestions: [{ label: "Always allow Bash(npm test)" }],
});

describe("turn lifecycle from hooks", () => {
  it("walks session start, prompt, tools, stop and acknowledge", () => {
    let registry = run(
      hook("session-start", {
        sessionId: "s-1",
        transcriptPath: "/t.jsonl",
        cwd: "/repo",
        reason: "startup",
      }),
    );
    let agent = agentOf(registry);
    expect(agent).toMatchObject({
      state: "idle",
      sessionId: "s-1",
      transcriptPath: "/t.jsonl",
      cwd: "/repo",
      turn: 0,
      paneId: 2,
      provenance: "hook",
    });
    expect(agent.attentionSince).toBeNull();

    registry = reduceAgents(registry, hook("prompt", { message: "fix it" }));
    agent = agentOf(registry);
    expect(agent).toMatchObject({
      state: "working",
      turn: 1,
      lastPrompt: "fix it",
    });

    registry = reduceAgents(
      registry,
      hook("tool-start", { tool: { name: "Bash", inputPreview: "ls" } }),
    );
    expect(agentOf(registry).currentTool).toMatchObject({
      name: "Bash",
      inputPreview: "ls",
    });

    registry = reduceAgents(
      registry,
      hook("tool-end", { tool: { name: "Bash", inputPreview: "ls" } }),
    );
    expect(agentOf(registry).currentTool).toBeNull();
    expect(agentOf(registry).state).toBe("working");

    registry = reduceAgents(registry, hook("stop", { message: "All done" }));
    agent = agentOf(registry);
    expect(agent).toMatchObject({
      state: "done",
      lastMessage: "All done",
      currentTool: null,
    });
    expect(agent.attentionSince).not.toBeNull();

    registry = reduceAgents(registry, {
      type: "acknowledge",
      ptyId: PTY,
      at: tick(),
    });
    expect(agentOf(registry)).toMatchObject({
      state: "idle",
      attentionSince: null,
    });

    registry = reduceAgents(registry, hook("prompt"));
    expect(agentOf(registry).turn).toBe(2);
  });

  it("counts a turn per prompt and resets on a new session", () => {
    const registry = run(
      hook("session-start", { reason: "startup" }),
      hook("prompt"),
      hook("stop"),
      hook("prompt"),
      hook("stop"),
      hook("prompt"),
    );
    expect(agentOf(registry).turn).toBe(3);
    const cleared = reduceAgents(
      registry,
      hook("session-start", { reason: "clear", sessionId: "s-2" }),
    );
    expect(agentOf(cleared)).toMatchObject({
      turn: 0,
      state: "idle",
      sessionId: "s-2",
    });
  });

  it("keeps the run going across a compaction", () => {
    const registry = run(
      hook("prompt"),
      hook("session-start", { reason: "compact", sessionId: "s-9" }),
    );
    expect(agentOf(registry)).toMatchObject({
      state: "working",
      turn: 1,
      sessionId: "s-9",
    });
  });

  it("keeps the last session id when later events omit it", () => {
    const registry = run(
      hook("session-start", { sessionId: "s-1" }),
      hook("prompt"),
      hook("stop", { sessionId: "s-1" }),
    );
    expect(agentOf(registry).sessionId).toBe("s-1");
  });

  it("treats an interrupt, an aborted stop and a session end as idle", () => {
    const cases: [string, AgentModelEvent][] = [
      ["interrupt", hook("interrupt")],
      ["aborted stop", hook("stop", { reason: "aborted" })],
      ["session end", hook("session-end", { reason: "other" })],
    ];
    for (const [name, event] of cases) {
      const registry = run(hook("prompt"), event);
      expect(agentOf(registry).state, name).toBe("idle");
      expect(agentOf(registry).attentionSince, name).toBeNull();
    }
  });

  it("flags API failures as errors until acknowledged", () => {
    const registry = run(
      hook("prompt"),
      hook("stop-failure", { reason: "rate_limit", message: "Rate limited" }),
    );
    expect(agentOf(registry)).toMatchObject({
      state: "error",
      waitingReason: "error",
      lastMessage: "Rate limited",
    });
    expect(
      stateAfter(hook("prompt"), hook("stop-failure"), {
        type: "acknowledge",
        ptyId: PTY,
        at: tick(),
      }),
    ).toBe("idle");
  });
});

describe("permission requests", () => {
  it("waits for approval and returns to work when the UI allows", () => {
    let registry = run(
      hook("prompt"),
      hook("permission-request", {
        message: "Run tests",
        permission: permission("d-1"),
      }),
    );
    let agent = agentOf(registry);
    expect(agent).toMatchObject({
      state: "needs-approval",
      waitingReason: "permission",
      lastMessage: "Run tests",
    });
    expect(agent.pendingPermissions[0]).toMatchObject({
      requestId: "d-1",
      tool: "Bash",
      inputPreview: "npm test",
    });
    expect(agent.attentionSince).not.toBeNull();

    registry = reduceAgents(
      registry,
      hook("permission-resolved", {
        permission: { ...permission("d-1"), outcome: "allow" },
      }),
    );
    agent = agentOf(registry);
    expect(agent.state).toBe("working");
    expect(agent.pendingPermissions).toEqual([]);
    expect(agent.attentionSince).toBeNull();
  });

  it("resolves by outcome", () => {
    const table: [string, AgentState, boolean][] = [
      ["allow", "working", false],
      ["deny", "working", false],
      ["ask", "needs-approval", false],
      ["timeout", "needs-approval", false],
      ["agent-gone", "working", false],
      ["pane-closed", "needs-approval", false],
      ["ui-gone", "needs-approval", false],
    ];
    for (const [outcome, state, pending] of table) {
      const registry = run(
        hook("prompt"),
        hook("permission-request", { permission: permission("d-7") }),
        hook("permission-resolved", {
          permission: { ...permission("d-7"), outcome },
        }),
      );
      expect(agentOf(registry).state, outcome).toBe(state);
      expect(agentOf(registry).pendingPermissions.length > 0, outcome).toBe(
        pending,
      );
    }
  });

  it("ignores a resolution for another request", () => {
    const before = run(
      hook("prompt"),
      hook("permission-request", { permission: permission("d-1") }),
    );
    const after = reduceAgents(
      before,
      hook("permission-resolved", {
        permission: { ...permission("d-0"), outcome: "allow" },
      }),
    );
    expect(agentOf(after).pendingPermissions[0]?.requestId).toBe("d-1");
    expect(agentOf(after).state).toBe("needs-approval");
  });

  it("records a request Terax cannot answer without an id", () => {
    const registry = run(
      hook("prompt"),
      hook("permission-request", { permission: permission() }),
    );
    expect(agentOf(registry).pendingPermissions[0]?.requestId).toBeNull();
  });

  it("goes back to work when the approved tool finishes", () => {
    const registry = run(
      hook("prompt"),
      hook("permission-request", { permission: permission("d-1") }),
      hook("tool-end", { tool: { name: "Bash", inputPreview: "npm test" } }),
    );
    expect(agentOf(registry)).toMatchObject({
      state: "working",
      pendingPermissions: [],
    });
  });
});

describe("background tool hooks racing a pending approval", () => {
  const bash = { name: "Bash", inputPreview: "npm test", id: "t-1" };
  const other = { name: "Read", inputPreview: "/a.ts", id: "t-2" };

  function pending(): AgentRegistry {
    return run(
      hook("prompt"),
      hook("permission-request", { permission: permission("d-1") }),
    );
  }

  it("keeps the approval when the tool start trails the request", () => {
    const registry = reduceAgents(
      pending(),
      hook("tool-start", { tool: bash }),
    );
    expect(agentOf(registry)).toMatchObject({
      state: "needs-approval",
      waitingReason: "permission",
    });
    expect(agentOf(registry).pendingPermissions[0]?.requestId).toBe("d-1");
    expect(agentOf(registry).attentionSince).not.toBeNull();
  });

  it("keeps the approval through traffic from unrelated tools", () => {
    let registry = pending();
    registry = reduceAgents(registry, hook("tool-start", { tool: other }));
    registry = reduceAgents(registry, hook("tool-end", { tool: other }));
    registry = reduceAgents(
      registry,
      hook("tool-end", { tool: { name: "Bash", inputPreview: "ls" } }),
    );
    expect(agentOf(registry).state).toBe("needs-approval");
    expect(agentOf(registry).pendingPermissions[0]?.tool).toBe("Bash");
  });

  it("is resolved only by the end of the tool that was waiting", () => {
    let registry = reduceAgents(pending(), hook("tool-start", { tool: bash }));
    registry = reduceAgents(registry, hook("tool-end", { tool: other }));
    expect(agentOf(registry).state).toBe("needs-approval");
    registry = reduceAgents(registry, hook("tool-end", { tool: bash }));
    expect(agentOf(registry)).toMatchObject({
      state: "working",
      pendingPermissions: [],
      attentionSince: null,
    });
    expect(agentOf(registry).runningTools).toEqual({});
  });

  it("still lets tool traffic mean work when nothing is pending", () => {
    expect(
      stateAfter(
        hook("prompt"),
        hook("notification", { notificationType: "idle_prompt" }),
        hook("tool-start", { tool: other }),
      ),
    ).toBe("working");
  });

  it("tracks parallel tools by id and ends the right one", () => {
    let registry = run(
      hook("prompt"),
      hook("tool-start", { tool: bash }),
      hook("tool-start", { tool: other }),
    );
    expect(Object.keys(agentOf(registry).runningTools).sort()).toEqual([
      "t-1",
      "t-2",
    ]);
    expect(agentOf(registry).currentTool?.id).toBe("t-2");
    registry = reduceAgents(registry, hook("tool-end", { tool: other }));
    expect(agentOf(registry).currentTool?.id).toBe("t-1");
    registry = reduceAgents(registry, hook("tool-end", { tool: bash }));
    expect(agentOf(registry).currentTool).toBeNull();
    expect(agentOf(registry).runningTools).toEqual({});
  });

  it("matches a tool end to its start by call when ids are missing", () => {
    const bare = { name: "Bash", inputPreview: "make" };
    let registry = run(hook("prompt"), hook("tool-start", { tool: bare }));
    expect(Object.keys(agentOf(registry).runningTools)).toHaveLength(1);
    registry = reduceAgents(
      registry,
      hook("tool-end", { tool: { ...bare, id: "t-9" } }),
    );
    expect(agentOf(registry).runningTools).toEqual({});
  });

  it("drops running tools when the turn ends", () => {
    const registry = run(
      hook("prompt"),
      hook("tool-start", { tool: bash }),
      hook("stop"),
    );
    expect(agentOf(registry).runningTools).toEqual({});
    expect(agentOf(registry).currentTool).toBeNull();
  });
});

describe("notifications", () => {
  const table: [string | undefined, AgentState][] = [
    ["permission_prompt", "needs-approval"],
    ["ToolPermission", "needs-approval"],
    ["idle_prompt", "needs-input"],
    ["elicitation_dialog", "needs-input"],
    ["elicitation_url_dialog", "needs-input"],
    ["agent_needs_input", "needs-input"],
    [undefined, "needs-input"],
    ["something_new", "needs-input"],
    ["auth_success", "working"],
    ["elicitation_complete", "working"],
    ["agent_completed", "working"],
    ["quota_auto_resume_fired", "working"],
    ["plugin_notification", "working"],
  ];

  it.each(table)("%s while working leads to %s", (type, state) => {
    expect(
      stateAfter(
        hook("prompt"),
        hook("notification", { notificationType: type, message: "hi" }),
      ),
    ).toBe(state);
  });

  it("records the waiting reason and message", () => {
    const registry = run(
      hook("prompt"),
      hook("notification", {
        notificationType: "idle_prompt",
        message: "Claude is waiting for your input",
      }),
    );
    expect(agentOf(registry)).toMatchObject({
      waitingReason: "idle",
      lastMessage: "Claude is waiting for your input",
    });
  });

  it("never downgrades a finished turn or a pending approval", () => {
    expect(
      stateAfter(
        hook("prompt"),
        hook("stop"),
        hook("notification", { notificationType: "idle_prompt" }),
      ),
    ).toBe("done");
    expect(
      stateAfter(
        hook("prompt"),
        hook("permission-request", { permission: permission() }),
        hook("notification", { notificationType: "idle_prompt" }),
      ),
    ).toBe("needs-approval");
    expect(
      stateAfter(
        hook("prompt"),
        hook("permission-request", { permission: permission() }),
        hook("notification", { notificationType: "permission_prompt" }),
      ),
    ).toBe("needs-approval");
  });

  it("keeps the original attention time while the need continues", () => {
    const first = run(
      hook("prompt"),
      hook("notification", { notificationType: "idle_prompt" }),
    );
    const since = agentOf(first).attentionSince;
    const later = reduceAgents(
      first,
      hook("permission-request", { permission: permission() }),
    );
    expect(agentOf(later).attentionSince).toBe(since);
  });
});

describe("tool and subagent activity", () => {
  it("ignores tool starts once the turn is over", () => {
    const registry = run(
      hook("prompt"),
      hook("stop"),
      hook("tool-start", { tool: { name: "Bash", inputPreview: "late" } }),
    );
    expect(agentOf(registry)).toMatchObject({
      state: "done",
      currentTool: null,
    });
  });

  it("clears a stale current tool on a late tool end without reviving", () => {
    const registry = run(hook("prompt"), hook("stop"), hook("tool-end"));
    expect(agentOf(registry).state).toBe("done");
  });

  it("resumes from an idle prompt when tools run again", () => {
    expect(
      stateAfter(
        hook("prompt"),
        hook("notification", { notificationType: "idle_prompt" }),
        hook("tool-start", { tool: { name: "Read", inputPreview: "a" } }),
      ),
    ).toBe("working");
  });

  it("summarizes subagents and resets them each turn", () => {
    let registry = run(
      hook("prompt"),
      hook("subagent-start", {
        subagent: { id: "a1", type: "reviewer", state: "running" },
      }),
      hook("subagent-start", {
        subagent: { id: "a2", type: "explorer", state: "running" },
      }),
      hook("subagent-stop", {
        message: "No issues",
        subagent: { id: "a1", type: "reviewer", state: "done" },
      }),
    );
    let agent = agentOf(registry);
    expect(agent.subagents.a1).toMatchObject({
      state: "done",
      message: "No issues",
    });
    expect(agent.subagents.a1?.endedAt).not.toBeNull();
    expect(agent.subagents.a2).toMatchObject({
      state: "running",
      endedAt: null,
    });
    expect(Object.keys(agent.subagents)).toHaveLength(2);

    registry = reduceAgents(registry, hook("prompt"));
    agent = agentOf(registry);
    expect(agent.subagents).toEqual({});
  });

  it("tolerates a subagent stop without a start", () => {
    const registry = run(
      hook("prompt"),
      hook("subagent-stop", {
        subagent: { id: "z", type: "x", state: "done" },
      }),
    );
    expect(agentOf(registry).subagents.z?.state).toBe("done");
  });
});

describe("process and OSC signals", () => {
  it("starts an agent from the process signal", () => {
    const registry = run(signal("started", "codex"));
    expect(agentOf(registry)).toMatchObject({
      agent: "codex",
      state: "starting",
      provenance: "process",
      paneId: null,
    });
  });

  it("maps OSC state hints for an agent without hooks", () => {
    const table: [AgentSignalKind, AgentState][] = [
      ["working", "working"],
      ["attention", "needs-input"],
      ["finished", "done"],
    ];
    for (const [kind, state] of table) {
      const registry = run(signal("started", "codex"), signal(kind));
      expect(agentOf(registry).state, kind).toBe(state);
      expect(agentOf(registry).provenance, kind).toBe("osc");
    }
  });

  it("ignores OSC hints for a hooked agent", () => {
    const registry = run(
      signal("started", "claude"),
      hook("prompt"),
      signal("finished"),
      signal("attention"),
    );
    expect(agentOf(registry)).toMatchObject({
      state: "working",
      provenance: "hook",
    });
  });

  it("does not invent an agent from a hint with no start", () => {
    expect(run(signal("working"), signal("finished"))).toEqual({});
  });

  it("marks the agent exited and keeps the entry for the UI", () => {
    const registry = run(
      hook("prompt"),
      hook("permission-request", { permission: permission("d-1") }),
      signal("exited"),
    );
    expect(agentOf(registry)).toMatchObject({
      state: "exited",
      attentionSince: null,
      pendingPermissions: [],
      currentTool: null,
    });
    expect(reduceAgents(registry, signal("exited"))).toBe(registry);
  });

  it("starts a fresh run in the same terminal after an exit", () => {
    const registry = run(
      hook("prompt"),
      hook("prompt"),
      signal("exited"),
      signal("started", "codex"),
    );
    expect(agentOf(registry)).toMatchObject({
      agent: "codex",
      state: "starting",
      turn: 0,
      provenance: "process",
    });
  });

  it("lets a hook revive an exited terminal but not a trailing tool event", () => {
    const exited = run(hook("prompt"), signal("exited"));
    expect(agentOf(reduceAgents(exited, hook("tool-end"))).state).toBe(
      "exited",
    );
    expect(agentOf(reduceAgents(exited, hook("session-end"))).state).toBe(
      "exited",
    );
    const revived = reduceAgents(exited, hook("session-start"));
    expect(agentOf(revived)).toMatchObject({ state: "idle", turn: 0 });
  });

  it("does not create an agent from a trailing tool or session end", () => {
    for (const kind of ["tool-start", "tool-end", "session-end"] as const) {
      expect(run(hook(kind)), kind).toEqual({});
    }
  });

  it("names a process-only agent from the first signal that knows its name", () => {
    const registry = run(signal("started"), signal("started", "gemini"));
    expect(agentOf(registry).agent).toBe("gemini");
  });
});

describe("provenance", () => {
  it("only ever strengthens during a run", () => {
    let registry = run(signal("started", "claude"));
    expect(agentOf(registry).provenance).toBe("process");
    registry = reduceAgents(registry, signal("working"));
    expect(agentOf(registry).provenance).toBe("osc");
    registry = reduceAgents(registry, hook("prompt"));
    expect(agentOf(registry).provenance).toBe("hook");
    registry = reduceAgents(registry, signal("working"));
    expect(agentOf(registry).provenance).toBe("hook");
  });
});

describe("registry handling", () => {
  it("keeps agents in separate terminals apart", () => {
    const other: AgentModelEvent = {
      type: "hook",
      event: {
        paneId: 9,
        ptyId: 77,
        agent: "codex",
        kind: "prompt",
        at: tick(),
      },
    };
    const registry = run(hook("prompt"), other, hook("stop"));
    expect(registry[PTY]?.state).toBe("done");
    expect(registry[77]).toMatchObject({ state: "working", agent: "codex" });
  });

  it("removes an agent and ignores unknown removals and acknowledgements", () => {
    const registry = run(hook("prompt"));
    const removed = reduceAgents(registry, { type: "remove", ptyId: PTY });
    expect(removed).toEqual({});
    expect(reduceAgents(removed, { type: "remove", ptyId: PTY })).toBe(removed);
    expect(
      reduceAgents(registry, { type: "acknowledge", ptyId: PTY, at: tick() }),
    ).toBe(registry);
    expect(
      reduceAgents(registry, { type: "acknowledge", ptyId: 1, at: tick() }),
    ).toBe(registry);
  });

  it("never mutates the registry it is given", () => {
    const before = run(hook("prompt"));
    const snapshot = JSON.stringify(before);
    Object.freeze(before);
    Object.freeze(agentOf(before));
    reduceAgents(
      before,
      hook("permission-request", { permission: permission() }),
    );
    reduceAgents(before, hook("stop"));
    reduceAgents(before, signal("exited"));
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("notificationEffect", () => {
  it("is null only for informational notifications", () => {
    expect(notificationEffect("auth_success")).toBeNull();
    expect(notificationEffect("idle_prompt")?.reason).toBe("idle");
    expect(notificationEffect(undefined)?.reason).toBe("attention");
  });
});

describe("several approvals pending at once", () => {
  const first = { ...permission("d-1"), inputPreview: "npm test" };
  const second = { ...permission("d-2"), inputPreview: "npm run lint" };

  function both(): AgentRegistry {
    return run(
      hook("prompt"),
      hook("permission-request", { permission: first }),
      hook("permission-request", { permission: second }),
    );
  }

  it("tracks each request by id, oldest first", () => {
    const agent = agentOf(both());
    expect(agent.state).toBe("needs-approval");
    expect(agent.pendingPermissions.map((p) => p.requestId)).toEqual([
      "d-1",
      "d-2",
    ]);
  });

  it("stays blocked until every request is handled", () => {
    let registry = reduceAgents(
      both(),
      hook("permission-resolved", {
        permission: { ...first, outcome: "allow" },
      }),
    );
    expect(agentOf(registry).state).toBe("needs-approval");
    expect(
      agentOf(registry).pendingPermissions.map((p) => p.requestId),
    ).toEqual(["d-2"]);
    registry = reduceAgents(
      registry,
      hook("permission-resolved", {
        permission: { ...second, outcome: "deny" },
      }),
    );
    expect(agentOf(registry)).toMatchObject({
      state: "working",
      pendingPermissions: [],
    });
  });

  it("ends only the approval whose tool finished", () => {
    let registry = reduceAgents(
      both(),
      hook("tool-end", {
        tool: { name: "Bash", inputPreview: "npm run lint" },
      }),
    );
    expect(agentOf(registry).state).toBe("needs-approval");
    expect(
      agentOf(registry).pendingPermissions.map((p) => p.requestId),
    ).toEqual(["d-1"]);
    registry = reduceAgents(
      registry,
      hook("tool-end", { tool: { name: "Bash", inputPreview: "npm test" } }),
    );
    expect(agentOf(registry).state).toBe("working");
  });

  it("replaces a repeated request and ignores resolutions it does not know", () => {
    let registry = reduceAgents(
      both(),
      hook("permission-request", { permission: first }),
    );
    expect(agentOf(registry).pendingPermissions).toHaveLength(2);
    const before = registry;
    registry = reduceAgents(
      registry,
      hook("permission-resolved", {
        permission: { ...permission("d-9"), outcome: "allow" },
      }),
    );
    expect(registry[PTY]?.pendingPermissions).toHaveLength(2);
    registry = reduceAgents(
      before,
      hook("permission-resolved", {
        permission: { tool: "Bash", inputPreview: "" },
      }),
    );
    expect(agentOf(registry).pendingPermissions).toHaveLength(2);
  });
});

describe("bounds on hook-driven collections", () => {
  it("keeps the newest running tools", () => {
    const events: AgentModelEvent[] = [hook("prompt")];
    for (let index = 0; index < 200; index++) {
      events.push(
        hook("tool-start", {
          tool: {
            name: "Bash",
            inputPreview: `cmd ${index}`,
            id: `t-${index}`,
          },
        }),
      );
    }
    const agent = agentOf(run(...events));
    const ids = Object.keys(agent.runningTools);
    expect(ids).toHaveLength(64);
    expect(ids).toContain("t-199");
    expect(ids).not.toContain("t-0");
    expect(agent.currentTool?.id).toBe("t-199");
  });

  it("keeps the newest approvals and subagents", () => {
    const events: AgentModelEvent[] = [hook("prompt")];
    for (let index = 0; index < 20; index++) {
      events.push(
        hook("permission-request", {
          permission: permission(`d-${index}`),
        }),
      );
    }
    for (let index = 0; index < 100; index++) {
      events.push(
        hook("subagent-start", {
          subagent: { id: `a-${index}`, type: "x", state: "running" },
        }),
      );
    }
    const agent = agentOf(run(...events));
    expect(agent.pendingPermissions).toHaveLength(8);
    expect(
      agent.pendingPermissions[agent.pendingPermissions.length - 1]?.requestId,
    ).toBe("d-19");
    expect(Object.keys(agent.subagents)).toHaveLength(64);
    expect(agent.subagents["a-99"]).toBeDefined();
    expect(agent.subagents["a-0"]).toBeUndefined();
  });

  it("does not merge two calls that have different ids and the same input", () => {
    const a = { name: "Bash", inputPreview: "npm test", id: "t-1" };
    const b = { ...a, id: "t-2" };
    let registry = run(hook("prompt"), hook("tool-start", { tool: a }));
    registry = reduceAgents(registry, hook("tool-end", { tool: b }));
    expect(Object.keys(agentOf(registry).runningTools)).toEqual(["t-1"]);
    registry = reduceAgents(registry, hook("tool-end", { tool: a }));
    expect(agentOf(registry).runningTools).toEqual({});
  });
});
