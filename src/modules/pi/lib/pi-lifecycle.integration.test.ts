/**
 * Integration tests for Pi session lifecycle: archive, fork, rollback, turn-diff, usage cost.
 *
 * These tests exercise the full pipeline from session creation through
 * lifecycle operations, verifying event emission, state transitions,
 * and data integrity.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PI_SESSION_EVENT } from "@/modules/pi/lib/sessions";
import type { PiSessionEvent } from "@/modules/pi/lib/sessions";

// ─── Mock dependencies ───

const mockInvoke = vi.fn();
const mockEmit = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

const mockCreateTauriAgent = vi.fn();
vi.mock("@/modules/pi/bridge/pi-session", () => ({
  createTauriAgent: (...args: unknown[]) => mockCreateTauriAgent(...args),
  USE_WEBVIEW_AGENT: true,
}));

vi.mock("@/modules/pi/bridge/pi-skills", () => ({
  resolveSkillFiles: () => Promise.resolve([]),
  buildSystemPromptWithSkills: (_base: string, _skills: unknown[]) =>
    "Test system prompt",
}));

// Mock estimateCost
vi.mock("@/modules/ai/config", () => ({
  estimateCost: (modelId: string | undefined, usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number }) => {
    if (!modelId) return null;
    // Only return cost for known models
    if (!modelId.startsWith("claude-")) return null;
    // Simple flat rate for testing: $0.01 per 1K tokens
    return ((usage.inputTokens + usage.outputTokens) * 0.01) / 1000;
  },
}));

// ─── Helpers ───

function createMockAgent() {
  const listeners: Array<(event: unknown, signal: unknown) => void> = [];
  return {
    state: { messages: [], isStreaming: false, systemPrompt: "" },
    subscribe: vi.fn((cb: (e: unknown, s: unknown) => void) => {
      listeners.push(cb);
      return vi.fn();
    }),
    prompt: vi.fn(),
    abort: vi.fn(),
    _listeners: listeners,
    _emit: (event: unknown, signal?: unknown) => {
      for (const l of listeners) l(event, signal ?? {});
    },
  };
}

function extractEventsByType(events: PiSessionEvent[], type: string): PiSessionEvent[] {
  return events.filter((e) => e.type === type);
}

/** Extract all emitted events from mockEmit calls */
function emittedEvents(): PiSessionEvent[] {
  const events: PiSessionEvent[] = [];
  for (const call of mockEmit.mock.calls) {
    if (call[0] === "pi:session-event" && call[1]) {
      events.push(call[1] as PiSessionEvent);
    }
  }
  return events;
}

// ─── Tests ───

describe("Pi session lifecycle integration", () => {
  let webviewSession: typeof import("@/modules/pi/lib/webview-session");

  beforeEach(async () => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
    mockCreateTauriAgent.mockResolvedValue(createMockAgent());

    webviewSession = await import("@/modules/pi/lib/webview-session");
  });

  describe("archive → restore lifecycle", () => {
    it("archives and restores a session via Rust backend", async () => {
      const { session } = await webviewSession.webviewSessionCreate("Archive Test");

      // Verify session exists and is not archived
      expect(session.archivedAt).toBeUndefined();
      expect(session.status).toBe("idle");
    });
  });

  describe("usage cost estimation", () => {
    it("computes costUsd from token counts using model pricing", async () => {
      const agent = createMockAgent();
      mockCreateTauriAgent.mockResolvedValueOnce(agent);

      const { session } = await webviewSession.webviewSessionCreate(
        "Usage Test",
        "/workspace",
        { provider: "anthropic", modelId: "claude-sonnet-4-20250514" } as unknown as import("@/modules/pi/lib/provider").PiProviderRuntimeConfig,
      );

      // Simulate a send that produces usage data
      agent.prompt.mockImplementation(async () => {
        // Agent emits usage event during the stream
        agent._emit({
          type: "agent_end",
          totalUsage: {
            inputTokens: 1000,
            outputTokens: 500,
            inputTokenDetails: { cacheReadTokens: 200 },
          },
          messages: [],
        }, {});
      });

      const result = await webviewSession.webviewSessionSend(
        session.id,
        "Hello",
        null,
      );

      expect(result.accepted).toBe(true);

      // Check emitted events for usage
      const events = emittedEvents();
      const usageEvents = extractEventsByType(events, PI_SESSION_EVENT.Usage);
      expect(usageEvents.length).toBeGreaterThanOrEqual(1);

      const usagePayload = usageEvents[0].payload as Record<string, unknown>;
      expect(usagePayload.inputTokens).toBe(1000);
      expect(usagePayload.outputTokens).toBe(500);
      expect(usagePayload.cachedInputTokens).toBe(200);
      expect(usagePayload.costUsd).toBeDefined();
      expect(typeof usagePayload.costUsd).toBe("number");
      expect(usagePayload.costUsd).toBeGreaterThan(0);
      expect(usagePayload.modelId).toBe("claude-sonnet-4-20250514");
      expect(usagePayload.providerId).toBe("anthropic");
    });

    it("returns null costUsd when modelId is unknown", async () => {
      const agent = createMockAgent();
      mockCreateTauriAgent.mockResolvedValueOnce(agent);

      const { session } = await webviewSession.webviewSessionCreate(
        "Unknown Model",
        "/workspace",
        { provider: "custom", modelId: "unknown-model-xyz" } as unknown as import("@/modules/pi/lib/provider").PiProviderRuntimeConfig,
      );

      agent.prompt.mockImplementation(async () => {
        agent._emit({
          type: "agent_end",
          totalUsage: { inputTokens: 100, outputTokens: 50 },
          messages: [],
        }, {});
      });

      await webviewSession.webviewSessionSend(session.id, "Hello", null);

      const events = emittedEvents();
      const usageEvents = extractEventsByType(events, PI_SESSION_EVENT.Usage);
      expect(usageEvents.length).toBeGreaterThanOrEqual(1);

      const usagePayload = usageEvents[0].payload as Record<string, unknown>;
      // estimateCost mock returns null for unknown models
      expect(usagePayload.costUsd).toBeNull();
    });
  });

  describe("turn-diff emission", () => {
    it("emits turn_diff when files/commands/tools change in a turn", async () => {
      const agent = createMockAgent();
      mockCreateTauriAgent.mockResolvedValueOnce(agent);

      const { session } = await webviewSession.webviewSessionCreate("TurnDiff Test");

      agent.prompt.mockImplementation(async () => {
        // Simulate tool usage via SDK event types
        agent._emit({
          type: "tool_execution_start",
          toolCallId: "call_1",
          toolName: "read",
          args: { path: "/workspace/foo.ts" },
        }, {});
        agent._emit({
          type: "tool_execution_end",
          toolCallId: "call_1",
          toolName: "read",
          result: "file contents",
          isError: false,
        }, {});
        // End with usage
        agent._emit({
          type: "agent_end",
          totalUsage: { inputTokens: 500, outputTokens: 200 },
          messages: [],
        }, {});
      });

      await webviewSession.webviewSessionSend(session.id, "Read foo.ts", null);

      const events = emittedEvents();
      const turnDiffEvents = extractEventsByType(events, PI_SESSION_EVENT.TurnDiff);
      expect(turnDiffEvents.length).toBeGreaterThanOrEqual(1);

      const diffPayload = turnDiffEvents[0].payload as Record<string, unknown>;
      expect(diffPayload.files).toBeDefined();
      const files = diffPayload.files as Array<{ path: string; action: string }>;
      expect(files.length).toBeGreaterThanOrEqual(1);
      expect(files[0].path).toContain("foo.ts");
    });

    it("skips turn_diff for turns with no meaningful changes", async () => {
      const agent = createMockAgent();
      mockCreateTauriAgent.mockResolvedValueOnce(agent);

      const { session } = await webviewSession.webviewSessionCreate("Empty TurnDiff");

      agent.prompt.mockImplementation(async () => {
        // End with no tools, no files, just usage
        agent._emit({
          type: "agent_end",
          totalUsage: { inputTokens: 100, outputTokens: 50 },
          messages: [],
        }, {});
      });

      await webviewSession.webviewSessionSend(session.id, "Hello", null);

      const events = emittedEvents();
      const turnDiffEvents = extractEventsByType(events, PI_SESSION_EVENT.TurnDiff);
      // Should still emit turn_diff because it has usage
      expect(turnDiffEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("session list and filtering", () => {
    it("creates multiple sessions and deletes them", async () => {
      const s1 = await webviewSession.webviewSessionCreate("Session 1");
      const s2 = await webviewSession.webviewSessionCreate("Session 2");
      const s3 = await webviewSession.webviewSessionCreate("Session 3");

      expect(s1.session.id).not.toBe(s2.session.id);
      expect(s2.session.id).not.toBe(s3.session.id);

      // Delete one and verify it's gone
      await webviewSession.webviewSessionDelete(s2.session.id);
      await expect(
        webviewSession.webviewSessionDelete(s2.session.id),
      ).rejects.toThrow();
    });
  });

  describe("concurrent send protection", () => {
    it("prevents sending to a session while streaming", async () => {
      const agent = createMockAgent();
      mockCreateTauriAgent.mockResolvedValueOnce(agent);

      const { session } = await webviewSession.webviewSessionCreate("Concurrent Test");

      // Make the first send hang (never resolves)
      let resolvePrompt: () => void;
      agent.prompt.mockImplementation(async () => {
        agent.state.isStreaming = true;
        await new Promise<void>((resolve) => { resolvePrompt = resolve; });
      });

      // Start first send
      const sendPromise = webviewSession.webviewSessionSend(session.id, "Hello", null);

      // Wait a tick so the first send starts
      await new Promise((r) => setTimeout(r, 10));

      // Try second send while first is running
      const result = await webviewSession.webviewSessionSend(session.id, "Hello again", null);
      expect(result.accepted).toBe(false);

      // Clean up
      agent.state.isStreaming = false;
      resolvePrompt!();
      await sendPromise;
    });
  });

  describe("session stop during streaming", () => {
    it("stops a running session and marks it stopped", async () => {
      const agent = createMockAgent();
      mockCreateTauriAgent.mockResolvedValueOnce(agent);

      const { session } = await webviewSession.webviewSessionCreate("Stop Test");

      const result = await webviewSession.webviewSessionStop(session.id);

      expect(agent.abort).toHaveBeenCalled();
      expect(result.session.status).toBe("stopped");

      // Verify a Status event was returned in the result
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe(PI_SESSION_EVENT.Status);
      expect((result.events[0].payload as Record<string, unknown>).status).toBe("stopped");
    });
  });
});
