import { describe, expect, it } from "vitest";
import type { PiSession, PiSessionEvent } from "./sessions";
import {
  annotatePiSessionEventsBranch,
  applyPiSessionEvents,
  buildPiSessionTranscript,
  isPiSessionSendable,
  markPiSessionsStopped,
  mergePiSessionEvents,
  mergePiSessionSnapshots,
  nextPiRegenerateBranchIndex,
  upsertPiSession,
} from "./sessions";

function session(id: string, status: PiSession["status"]): PiSession {
  return {
    id,
    title: id,
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastPrompt: null,
  };
}

function event(
  id: string,
  type: string,
  payload: PiSessionEvent["payload"],
): PiSessionEvent {
  return {
    id,
    type,
    sessionId: "pi-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    payload,
  };
}

describe("buildPiSessionTranscript", () => {
  it("synthesizes branch metadata for plain responses so they can regenerate", () => {
    const transcript = buildPiSessionTranscript([
      event("evt-1", "session.input", { text: "Explain this project" }),
      event("evt-2", "session.output.text", { text: "First answer" }),
    ]);

    expect(transcript).toEqual([
      expect.objectContaining({
        id: "evt-1",
        kind: "user",
        text: "Explain this project",
      }),
      expect.objectContaining({
        id: "evt-2",
        kind: "assistant",
        text: "First answer",
        branchGroupId: "evt-1",
        branchIndex: 0,
        promptText: "Explain this project",
        branches: [
          expect.objectContaining({
            id: "evt-2",
            branchIndex: 0,
            text: "First answer",
          }),
        ],
      }),
    ]);
  });

  it("folds tool timeline events into a tool transcript item", () => {
    const transcript = buildPiSessionTranscript([
      event("evt-1", "session.input", { text: "Read package" }),
      event("evt-2", "session.tool.start", {
        toolCallId: "call-1",
        toolName: "read",
        input: { path: "package.json" },
      }),
      event("evt-3", "session.tool.approval.requested", {
        approvalId: "call-1",
        toolCallId: "call-1",
        toolName: "read",
        input: { path: "package.json" },
      }),
      event("evt-4", "session.tool.approval.responded", {
        approvalId: "call-1",
        toolCallId: "call-1",
        toolName: "read",
        approved: true,
      }),
      event("evt-5", "session.tool.result", {
        toolCallId: "call-1",
        toolName: "read",
        output: { content: "done", details: null },
        isError: false,
      }),
    ]);

    expect(transcript).toEqual([
      expect.objectContaining({ kind: "user", text: "Read package" }),
      expect.objectContaining({
        kind: "tool",
        toolCallId: "call-1",
        toolName: "read",
        toolInput: { path: "package.json" },
        toolOutput: { content: "done", details: null },
        toolState: "output-available",
        toolApproved: true,
        eventIds: ["evt-2", "evt-3", "evt-4", "evt-5"],
      }),
    ]);
  });

  it("marks denied tool approvals as denied output", () => {
    const transcript = buildPiSessionTranscript([
      event("evt-1", "session.tool.approval.requested", {
        approvalId: "call-1",
        toolCallId: "call-1",
        toolName: "bash",
        input: { command: "echo no" },
      }),
      event("evt-2", "session.tool.approval.responded", {
        approvalId: "call-1",
        toolCallId: "call-1",
        toolName: "bash",
        approved: false,
      }),
    ]);

    expect(transcript).toEqual([
      expect.objectContaining({
        kind: "tool",
        toolCallId: "call-1",
        toolName: "bash",
        toolState: "output-denied",
        toolApproved: false,
        eventIds: ["evt-1", "evt-2"],
      }),
    ]);
  });

  it("expires pending tool approvals when a restored session is stopped", () => {
    const transcript = buildPiSessionTranscript([
      event("evt-1", "session.tool.approval.requested", {
        approvalId: "call-1",
        toolCallId: "call-1",
        toolName: "bash",
        input: { command: "echo pending" },
      }),
      event("evt-2", "session.status", { status: "stopped" }),
    ]);

    expect(transcript).toEqual([
      expect.objectContaining({
        kind: "tool",
        toolCallId: "call-1",
        toolState: "output-denied",
        toolApproved: false,
        eventIds: ["evt-1", "evt-2"],
      }),
      expect.objectContaining({ kind: "system", text: "stopped" }),
    ]);
  });

  it("merges fallback regenerated prompts into the original user item", () => {
    const transcript = buildPiSessionTranscript([
      event("evt-1", "session.input", { text: "Explain" }),
      event("evt-2", "session.output.text", { text: "First" }),
      event("evt-3", "session.input", {
        text: "Explain",
        branch: {
          groupId: "evt-1",
          index: 1,
          regeneratedFromEventId: "evt-1",
        },
      }),
      event("evt-4", "session.output.text", {
        text: "Second",
        branch: {
          groupId: "evt-1",
          index: 1,
          regeneratedFromEventId: "evt-1",
        },
      }),
    ]);

    expect(transcript).toEqual([
      expect.objectContaining({
        id: "evt-1",
        kind: "user",
        text: "Explain",
        eventIds: ["evt-1", "evt-3"],
        branchGroupId: "evt-1",
      }),
      expect.objectContaining({
        kind: "assistant",
        branchGroupId: "evt-1",
        text: "Second",
        branches: [
          expect.objectContaining({ branchIndex: 0, text: "First" }),
          expect.objectContaining({ branchIndex: 1, text: "Second" }),
        ],
      }),
    ]);
  });

  it("groups regenerated outputs into assistant branches", () => {
    const firstBranch = { groupId: "turn-1", index: 0 };
    const secondBranch = {
      groupId: "turn-1",
      index: 1,
      regeneratedFromEventId: "evt-1",
    };

    const transcript = buildPiSessionTranscript([
      event("evt-1", "session.input", {
        text: "Explain this project",
        branch: firstBranch,
      }),
      event("evt-2", "session.output.text", {
        text: "First answer",
        branch: firstBranch,
      }),
      event("evt-3", "session.input", {
        text: "Explain this project",
        branch: secondBranch,
      }),
      event("evt-4", "session.output.text", {
        text: "Second answer",
        branch: secondBranch,
      }),
    ]);

    expect(transcript).toEqual([
      expect.objectContaining({
        id: "evt-1",
        kind: "user",
        text: "Explain this project",
        eventIds: ["evt-1", "evt-3"],
        branchGroupId: "turn-1",
      }),
      expect.objectContaining({
        kind: "assistant",
        text: "Second answer",
        branchGroupId: "turn-1",
        promptText: "Explain this project",
        branches: [
          expect.objectContaining({
            id: "evt-2",
            branchIndex: 0,
            text: "First answer",
            eventIds: ["evt-2"],
          }),
          expect.objectContaining({
            id: "evt-4",
            branchIndex: 1,
            text: "Second answer",
            eventIds: ["evt-4"],
          }),
        ],
      }),
    ]);
  });

  it("clears pending regenerate metadata after terminal status events", () => {
    const transcript = buildPiSessionTranscript([
      event("evt-1", "session.input", { text: "Will this finish?" }),
      event("evt-2", "session.status", { status: "idle" }),
      event("evt-3", "session.output.text", { text: "late unrelated output" }),
    ]);

    expect(transcript[2]).toEqual(
      expect.objectContaining({
        kind: "assistant",
        text: "late unrelated output",
      }),
    );
    expect(transcript[2]?.branchGroupId).toBeUndefined();
    expect(transcript[2]?.branches).toBeUndefined();
  });

  it("orders restart-safe event ids by embedded sequence when timestamps match", () => {
    expect(
      buildPiSessionTranscript([
        {
          ...event("evt_mpx_2_bbbbbbbbbbbb", "session.status", {
            status: "running",
          }),
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          ...event("evt_mpx_1_aaaaaaaaaaaa", "session.input", {
            text: "Hello",
          }),
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ]).map((item) => item.kind),
    ).toEqual(["user", "system"]);
  });

  it("orders events chronologically and coalesces output deltas", () => {
    expect(
      buildPiSessionTranscript([
        event("evt-10", "session.output.delta", { text: "?" }),
        event("evt-9", "session.output.delta", { text: "help" }),
        event("evt-8", "session.output.delta", { text: "I" }),
        event("evt-7", "session.output.delta", { text: "can" }),
        event("evt-6", "session.output.delta", { text: "How" }),
        event("evt-5", "session.output.delta", { text: "!" }),
        event("evt-4", "session.output.delta", { text: "Hey" }),
        event("evt-3", "session.status", { status: "running" }),
        event("evt-2", "session.input", { text: "Hey" }),
        event("evt-1", "session.created", {}),
      ]),
    ).toEqual([
      expect.objectContaining({ kind: "system", label: "Created" }),
      expect.objectContaining({ kind: "user", label: "Prompt", text: "Hey" }),
      expect.objectContaining({
        kind: "system",
        label: "Status",
        text: "running",
      }),
      expect.objectContaining({
        kind: "assistant",
        label: "Pi",
        text: "Hey! How can I help?",
        eventIds: [
          "evt-4",
          "evt-5",
          "evt-6",
          "evt-7",
          "evt-8",
          "evt-9",
          "evt-10",
        ],
      }),
    ]);
  });

  it("uses final output text to preserve paths and subword chunks", () => {
    expect(
      buildPiSessionTranscript([
        event("evt-6", "session.output.text", {
          text: "Current working directory:\n\n`/Users/mehmetcanbudak/Projects/terax-pi/src-tauri`",
        }),
        event("evt-5", "session.output.delta", { text: "tauri`" }),
        event("evt-4", "session.output.delta", { text: "src-" }),
        event("evt-3", "session.output.delta", { text: "/" }),
        event("evt-2", "session.output.delta", { text: "Projects" }),
        event("evt-1", "session.output.delta", { text: "/Users" }),
      ]),
    ).toEqual([
      expect.objectContaining({
        kind: "assistant",
        label: "Pi",
        text: "Current working directory:\n\n`/Users/mehmetcanbudak/Projects/terax-pi/src-tauri`",
        eventIds: ["evt-1", "evt-2", "evt-3", "evt-4", "evt-5", "evt-6"],
      }),
    ]);
  });

  it("attaches streamed reasoning to the assistant response", () => {
    const branch = { groupId: "turn-1", index: 0 };

    expect(
      buildPiSessionTranscript([
        event("evt-1", "session.input", { text: "Think", branch }),
        event("evt-2", "session.progress", { text: "Reasoning…", branch }),
        event("evt-3", "session.reasoning.delta", {
          text: "I",
          branch,
        }),
        event("evt-4", "session.reasoning.delta", {
          text: "checked",
          branch,
        }),
        event("evt-5", "session.reasoning.text", {
          text: "I checked the code.",
          branch,
        }),
        event("evt-6", "session.output.text", { text: "Answer", branch }),
      ]),
    ).toEqual([
      expect.objectContaining({ kind: "user", text: "Think" }),
      expect.objectContaining({ kind: "progress", text: "Reasoning…" }),
      expect.objectContaining({
        kind: "assistant",
        text: "Answer",
        reasoningText: "I checked the code.",
        branches: [
          expect.objectContaining({
            branchIndex: 0,
            text: "Answer",
            reasoningText: "I checked the code.",
            reasoningEventIds: ["evt-3", "evt-4", "evt-5"],
          }),
        ],
      }),
    ]);
  });

  it("keeps reasoning scoped to regenerated response branches", () => {
    const firstBranch = { groupId: "turn-1", index: 0 };
    const secondBranch = { groupId: "turn-1", index: 1 };

    const transcript = buildPiSessionTranscript([
      event("evt-1", "session.input", { text: "Explain", branch: firstBranch }),
      event("evt-2", "session.reasoning.text", {
        text: "First reasoning",
        branch: firstBranch,
      }),
      event("evt-3", "session.output.text", {
        text: "First answer",
        branch: firstBranch,
      }),
      event("evt-4", "session.input", {
        text: "Explain",
        branch: secondBranch,
      }),
      event("evt-5", "session.reasoning.text", {
        text: "Second reasoning",
        branch: secondBranch,
      }),
      event("evt-6", "session.output.text", {
        text: "Second answer",
        branch: secondBranch,
      }),
    ]);

    expect(transcript[1]).toEqual(
      expect.objectContaining({
        kind: "assistant",
        text: "Second answer",
        reasoningText: "Second reasoning",
        branches: [
          expect.objectContaining({
            branchIndex: 0,
            text: "First answer",
            reasoningText: "First reasoning",
          }),
          expect.objectContaining({
            branchIndex: 1,
            text: "Second answer",
            reasoningText: "Second reasoning",
          }),
        ],
      }),
    );
  });

  it("ignores empty streaming deltas", () => {
    expect(
      buildPiSessionTranscript([
        event("evt-1", "session.output.delta", { text: "" }),
      ]),
    ).toEqual([]);
  });

  it("carries prompt context into user transcript items", () => {
    const transcript = buildPiSessionTranscript([
      event("evt-1", "session.input", {
        text: "Where is this defined?",
        context: {
          workspaceRoot: "/Users/me/project",
          activeFile: "/Users/me/project/src/App.tsx",
          activeTerminalCwd: "/Users/me/project/src",
          activeTerminalPrivate: true,
        },
      }),
    ]);

    expect(transcript[0]).toEqual(
      expect.objectContaining({
        kind: "user",
        text: "Where is this defined?",
        context: {
          workspaceRoot: "/Users/me/project",
          activeFile: "/Users/me/project/src/App.tsx",
          activeTerminalCwd: "/Users/me/project/src",
          activeTerminalPrivate: true,
        },
      }),
    );
  });
});

describe("annotatePiSessionEventsBranch", () => {
  it("adds fallback branch metadata to unbranched regenerate events", () => {
    expect(
      annotatePiSessionEventsBranch(
        [
          event("evt-2", "session.input", { text: "Retry" }),
          event("evt-3", "session.reasoning.text", { text: "New thought" }),
          event("evt-4", "session.output.text", { text: "New answer" }),
          event("evt-5", "session.status", { status: "idle" }),
        ],
        { groupId: "evt-1", index: 1, regeneratedFromEventId: "evt-1" },
      ),
    ).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          branch: {
            groupId: "evt-1",
            index: 1,
            regeneratedFromEventId: "evt-1",
          },
        }),
      }),
      expect.objectContaining({
        payload: expect.objectContaining({
          branch: {
            groupId: "evt-1",
            index: 1,
            regeneratedFromEventId: "evt-1",
          },
        }),
      }),
      expect.objectContaining({
        payload: expect.objectContaining({
          branch: {
            groupId: "evt-1",
            index: 1,
            regeneratedFromEventId: "evt-1",
          },
        }),
      }),
      expect.objectContaining({ payload: { status: "idle" } }),
    ]);
  });

  it("preserves authoritative branch metadata from the host", () => {
    expect(
      annotatePiSessionEventsBranch(
        [
          event("evt-2", "session.output.text", {
            text: "New answer",
            branch: { groupId: "turn-1", index: 2 },
          }),
        ],
        { groupId: "evt-1", index: 1 },
      )[0].payload.branch,
    ).toEqual({ groupId: "turn-1", index: 2 });
  });
});

describe("nextPiRegenerateBranchIndex", () => {
  it("uses the next assistant branch slot", () => {
    const transcript = buildPiSessionTranscript([
      event("evt-1", "session.input", {
        text: "Explain",
        branch: { groupId: "turn-1", index: 0 },
      }),
      event("evt-2", "session.output.text", {
        text: "First",
        branch: { groupId: "turn-1", index: 0 },
      }),
      event("evt-3", "session.output.text", {
        text: "Second",
        branch: { groupId: "turn-1", index: 1 },
      }),
    ]);

    expect(nextPiRegenerateBranchIndex(transcript, "turn-1")).toBe(2);
    expect(nextPiRegenerateBranchIndex(transcript, "missing")).toBe(1);
  });

  it("uses the highest existing branch index when branch indices are sparse", () => {
    const transcript = buildPiSessionTranscript([
      event("evt-1", "session.input", {
        text: "Explain",
        branch: { groupId: "turn-1", index: 0 },
      }),
      event("evt-2", "session.output.text", {
        text: "First",
        branch: { groupId: "turn-1", index: 0 },
      }),
      event("evt-3", "session.output.text", {
        text: "Third",
        branch: { groupId: "turn-1", index: 2 },
      }),
    ]);

    expect(nextPiRegenerateBranchIndex(transcript, "turn-1")).toBe(3);
  });
});

describe("applyPiSessionEvents", () => {
  it("uses the latest chronological status when restored events are newest-first", () => {
    expect(
      applyPiSessionEvents(
        [session("pi-1", "running")],
        [
          event("evt-11", "session.status", { status: "idle" }),
          event("evt-3", "session.status", { status: "running" }),
        ],
      ),
    ).toEqual([session("pi-1", "idle")]);
  });

  it("applies rename and delete metadata events", () => {
    const renamed = applyPiSessionEvents(
      [session("pi-1", "idle")],
      [event("evt-12", "session.renamed", { title: "Reviewed plan" })],
    );

    expect(renamed[0]).toEqual(
      expect.objectContaining({ title: "Reviewed plan" }),
    );
    expect(
      applyPiSessionEvents(renamed, [
        event("evt-13", "session.deleted", { sessionId: "pi-1" }),
      ]),
    ).toEqual([]);
  });

  it("materializes sessions from created events before applying later metadata", () => {
    const created = {
      ...session("pi-created", "idle"),
      sdkSessionFile:
        "/Users/me/Library/Application Support/Terax/pi-sdk-sessions/one.jsonl",
    };
    const events = [
      {
        ...event("evt-20", "session.created", { session: created }),
        sessionId: "pi-created",
      },
      {
        ...event("evt-21", "session.renamed", { title: "Live rename" }),
        sessionId: "pi-created",
      },
      {
        ...event("evt-22", "session.status", { status: "running" }),
        sessionId: "pi-created",
      },
    ];

    expect(applyPiSessionEvents([], events)).toEqual([
      expect.objectContaining({
        id: "pi-created",
        title: "Live rename",
        status: "running",
        sdkSessionFile:
          "/Users/me/Library/Application Support/Terax/pi-sdk-sessions/one.jsonl",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ]);
  });

  it("hydrates resumed session snapshots from resume events", () => {
    const resumed = {
      ...session("pi-1", "idle"),
      sdkSessionFile: "/Users/me/app/pi-sdk-sessions/session.jsonl",
      updatedAt: "2026-01-01T00:00:02.000Z",
    };

    expect(
      applyPiSessionEvents(
        [session("pi-1", "stopped")],
        [event("evt-30", "session.resumed", { session: resumed })],
      ),
    ).toEqual([resumed]);
  });
});

describe("mergePiSessionEvents", () => {
  it("deduplicates events and evicts oldest entries by event order", () => {
    const merged = mergePiSessionEvents(
      [
        event("evt-1", "session.output.delta", { text: "old" }),
        event("evt-2", "session.output.delta", { text: "duplicate" }),
        event("evt-3", "session.output.delta", { text: "keep" }),
      ],
      [
        event("evt-2", "session.output.delta", { text: "replacement" }),
        event("evt-4", "session.output.delta", { text: "new" }),
      ],
      3,
    );

    expect(merged.map((next) => next.id)).toEqual(["evt-4", "evt-3", "evt-2"]);
    expect(merged.find((next) => next.id === "evt-2")?.payload.text).toBe(
      "replacement",
    );
  });

  it("windows per session so a busy session can't evict another's events", () => {
    const ev = (id: string, sessionId: string, createdAt: string) => ({
      id,
      type: "session.output.delta",
      sessionId,
      createdAt,
      payload: { text: id },
    });

    const merged = mergePiSessionEvents(
      [ev("b1", "pi-b", "2026-01-01T00:00:01.000Z")],
      [
        ev("a1", "pi-a", "2026-01-01T00:00:02.000Z"),
        ev("a2", "pi-a", "2026-01-01T00:00:03.000Z"),
        ev("a3", "pi-a", "2026-01-01T00:00:04.000Z"),
      ],
      2, // per-session limit
    );

    const ids = merged.map((next) => next.id);
    // Session A keeps only its newest 2 …
    expect(ids).toContain("a3");
    expect(ids).toContain("a2");
    expect(ids).not.toContain("a1");
    // … but session B's lone event is NOT evicted by A's activity.
    expect(ids).toContain("b1");
  });
});

describe("mergePiSessionSnapshots", () => {
  it("preserves history-only sessions as stopped when the live host has no record", () => {
    expect(
      mergePiSessionSnapshots([session("pi-1", "idle")], [], {
        missingStatus: "stopped",
      }),
    ).toEqual([session("pi-1", "stopped")]);
  });

  it("keeps live sessions first and appends stopped history-only sessions", () => {
    expect(
      mergePiSessionSnapshots(
        [session("pi-1", "idle"), session("pi-2", "idle")],
        [session("pi-2", "running"), session("pi-3", "idle")],
        { missingStatus: "stopped" },
      ),
    ).toEqual([
      session("pi-2", "running"),
      session("pi-3", "idle"),
      session("pi-1", "stopped"),
    ]);
  });
});

describe("markPiSessionsStopped", () => {
  it("marks visible history sessions as stopped when the runtime shuts down", () => {
    expect(markPiSessionsStopped([session("pi-1", "running")])).toEqual([
      session("pi-1", "stopped"),
    ]);
  });
});

describe("isPiSessionSendable", () => {
  it("allows idle and error sessions to accept retry prompts", () => {
    expect(isPiSessionSendable(session("pi-1", "idle"))).toBe(true);
    expect(isPiSessionSendable(session("pi-1", "running"))).toBe(false);
    expect(isPiSessionSendable(session("pi-1", "stopped"))).toBe(false);
    expect(isPiSessionSendable(session("pi-1", "error"))).toBe(true);
    expect(isPiSessionSendable(null)).toBe(false);
  });
});

describe("upsertPiSession", () => {
  it("prepends new sessions", () => {
    expect(
      upsertPiSession([session("pi-1", "idle")], session("pi-2", "idle")),
    ).toEqual([session("pi-2", "idle"), session("pi-1", "idle")]);
  });

  it("replaces existing sessions in place", () => {
    expect(
      upsertPiSession(
        [session("pi-2", "idle"), session("pi-1", "idle")],
        session("pi-1", "running"),
      ),
    ).toEqual([session("pi-2", "idle"), session("pi-1", "running")]);
  });
});
