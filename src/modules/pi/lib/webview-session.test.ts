/**
 * Tests for the Pi webview session backend abstraction.
 *
 * Validates that:
 * - The backend abstraction routes to the correct implementation
 * - Tool approval gate works correctly (approve/deny/timeout)
 * - Event emission matches the session lifecycle
 * - Session CRUD operations work through the backend
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PI_SESSION_EVENT } from "@/modules/pi/lib/sessions";
import {
  deserializeAgentTranscript,
  serializeAgentTranscript,
} from "@/modules/pi/lib/sessions/agent-transcript";

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
const mockResolveAgentModel = vi.fn();
vi.mock("@/modules/pi/bridge/pi-session", () => ({
  createTauriAgent: (...args: unknown[]) => mockCreateTauriAgent(...args),
  resolveAgentModel: (...args: unknown[]) => mockResolveAgentModel(...args),
}));

const mockResolveSkillFiles = vi.fn();
const mockBuildSystemPromptWithSkills = vi.fn();
vi.mock("@/modules/pi/bridge/pi-skills", () => ({
  resolveSkillFiles: (...args: unknown[]) => mockResolveSkillFiles(...args),
  buildSystemPromptWithSkills: (...args: unknown[]) =>
    mockBuildSystemPromptWithSkills(...args),
}));

// ─── Tests ───

describe("Pi webview session backend", () => {
  // Import dynamically after mocks are set up
  let webviewSession: typeof import("@/modules/pi/lib/webview-session");

  beforeEach(async () => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue(undefined);
    mockResolveSkillFiles.mockResolvedValue([]);
    mockBuildSystemPromptWithSkills.mockReturnValue("Test system prompt");
    mockResolveAgentModel.mockImplementation(
      (options: { provider: string; modelId: string }) => ({
        id: options.modelId,
        provider: options.provider,
      }),
    );
    mockCreateTauriAgent.mockResolvedValue({
      state: { messages: [], isStreaming: false },
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(),
      abort: vi.fn(),
    });

    webviewSession = await import("@/modules/pi/lib/webview-session");
  });

  describe("session creation", () => {
    it("creates a session and persists it", async () => {
      const result = await webviewSession.webviewSessionCreate(
        "Test Session",
        "/workspace",
        {
          provider: "anthropic",
          modelId: "claude-sonnet-4-20250514",
        } as unknown as import("@/modules/pi/lib/provider").PiProviderRuntimeConfig,
      );

      expect(result.session).toBeDefined();
      expect(result.session.title).toBe("Test Session");
      expect(result.session.cwd).toBe("/workspace");
      expect(result.session.status).toBe("idle");
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe(PI_SESSION_EVENT.Created);

      // Verify persistence was called
      expect(mockInvoke).toHaveBeenCalledWith(
        "pi_store_record_session",
        expect.objectContaining({
          session: expect.objectContaining({ title: "Test Session" }),
        }),
      );
    });

    it("persists provider metadata on created sessions", async () => {
      const result = await webviewSession.webviewSessionCreate(
        "Provider Session",
        "/workspace",
        {
          authMode: "terax",
          provider: "openai-compatible",
          modelId: "zai/glm-4.5",
          sourceModelId: "compat:endpoint-1",
          baseUrl: "https://gateway.example.test/v1",
          customEndpointId: "endpoint-1",
        } as import("@/modules/pi/lib/provider").PiProviderRuntimeConfig,
      );

      expect(result.session).toMatchObject({
        authMode: "terax",
        providerId: "openai-compatible",
        modelId: "zai/glm-4.5",
        sourceModelId: "compat:endpoint-1",
        baseUrl: "https://gateway.example.test/v1",
        customEndpointId: "endpoint-1",
      });
      expect(mockInvoke).toHaveBeenCalledWith(
        "pi_store_record_session",
        expect.objectContaining({
          session: expect.objectContaining({
            providerId: "openai-compatible",
            modelId: "zai/glm-4.5",
            customEndpointId: "endpoint-1",
          }),
        }),
      );
    });

    it("uses defaults when optional params are omitted", async () => {
      const result = await webviewSession.webviewSessionCreate();

      expect(result.session.title).toBe("New session");
      expect(result.session.cwd).toBe("/");
    });
  });

  describe("session send with approval gate", () => {
    it("emits events during send and persists on completion", async () => {
      const { session } = await webviewSession.webviewSessionCreate(
        "Send Test",
        "/workspace",
      );

      // The agent mock's prompt resolves immediately
      const agent = await mockCreateTauriAgent.mock.results[0].value;
      agent.prompt.mockResolvedValue(undefined);
      agent.subscribe.mockImplementation(
        (cb: (e: unknown, s: unknown) => void) => {
          // Simulate agent_end
          cb({ type: "agent_end", messages: [] }, {});
          return vi.fn();
        },
      );

      const result = await webviewSession.webviewSessionSend(
        session.id,
        "Hello",
        null,
      );

      expect(result.accepted).toBe(true);
      expect(result.session.lastPrompt).toBe("Hello");

      // Verify events were emitted via Tauri
      expect(mockEmit).toHaveBeenCalled();
    });

    it("injects the IDE context as an env block into the model turn", async () => {
      const { session } = await webviewSession.webviewSessionCreate(
        "Ctx",
        "/ws",
      );
      const agent = await mockCreateTauriAgent.mock.results[0].value;
      agent.prompt.mockResolvedValue(undefined);
      agent.subscribe.mockImplementation(
        (cb: (e: unknown, s: unknown) => void) => {
          cb({ type: "agent_end", messages: [] }, {});
          return vi.fn();
        },
      );

      await webviewSession.webviewSessionSend(session.id, "fix the bug", {
        workspaceRoot: "/ws",
        activeFile: "/ws/src/a.ts",
      });

      // The model sees the env block; the user's text is preserved.
      const sent = agent.prompt.mock.calls[0][0] as string;
      expect(sent).toContain("<env>");
      expect(sent).toContain("workspace_root: /ws");
      expect(sent).toContain("active_file: /ws/src/a.ts");
      expect(sent).toContain("fix the bug");
    });

    it("resolves a pending ask_question with the user's answer", async () => {
      let capturedQuestionGate:
        | ((
            id: string,
            params: unknown,
            signal?: AbortSignal,
          ) => Promise<unknown>)
        | undefined;
      mockCreateTauriAgent.mockImplementation(
        (opts: {
          questionGate?: (
            id: string,
            params: unknown,
            signal?: AbortSignal,
          ) => Promise<unknown>;
        }) => {
          capturedQuestionGate = opts.questionGate;
          return Promise.resolve({
            state: { messages: [], isStreaming: false },
            subscribe: vi.fn(() => vi.fn()),
            prompt: vi.fn(),
            abort: vi.fn(),
          });
        },
      );

      const { session } = await webviewSession.webviewSessionCreate("Q", "/ws");

      const answer = capturedQuestionGate?.("q-1", {
        question: "Pick",
        options: [{ label: "A" }, { label: "B" }],
        allowMultiple: false,
      });
      await webviewSession.webviewSessionQuestionRespond(session.id, "q-1", [
        { label: "B" },
      ]);

      await expect(answer).resolves.toEqual([{ label: "B" }]);
    });

    it("persists the asked question so it survives a restart", async () => {
      let capturedQuestionGate:
        | ((
            id: string,
            params: unknown,
            signal?: AbortSignal,
          ) => Promise<unknown>)
        | undefined;
      mockCreateTauriAgent.mockImplementation(
        (opts: {
          questionGate?: (
            id: string,
            params: unknown,
            signal?: AbortSignal,
          ) => Promise<unknown>;
        }) => {
          capturedQuestionGate = opts.questionGate;
          return Promise.resolve({
            state: { messages: [], isStreaming: false },
            subscribe: vi.fn(() => vi.fn()),
            prompt: vi.fn(),
            abort: vi.fn(),
          });
        },
      );

      const { session } = await webviewSession.webviewSessionCreate("Q", "/ws");
      void capturedQuestionGate?.("q-1", {
        question: "Pick",
        options: [{ label: "A" }],
        allowMultiple: false,
      });

      const persisted = mockInvoke.mock.calls.find(
        ([cmd, args]) =>
          cmd === "pi_store_record_events" &&
          Array.isArray((args as { events?: unknown[] })?.events) &&
          (args as { events: { type: string }[] }).events.some(
            (e) => e.type === PI_SESSION_EVENT.QuestionAsked,
          ),
      );
      expect(persisted).toBeTruthy();
      expect(session.id).toBeDefined();
    });

    it("rejects concurrent sends", async () => {
      const { session } = await webviewSession.webviewSessionCreate();

      const agent = await mockCreateTauriAgent.mock.results[0].value;
      agent.state.isStreaming = true;

      const result = await webviewSession.webviewSessionSend(
        session.id,
        "Hello",
        null,
      );

      expect(result.accepted).toBe(false);
    });
  });

  describe("session stop", () => {
    it("aborts the agent and marks session stopped", async () => {
      const { session } = await webviewSession.webviewSessionCreate();
      const agent = await mockCreateTauriAgent.mock.results[0].value;

      const result = await webviewSession.webviewSessionStop(session.id);

      expect(agent.abort).toHaveBeenCalled();
      expect(result.session.status).toBe("stopped");
      // Outstanding Rust-side approval grants are forgotten on teardown.
      expect(mockInvoke).toHaveBeenCalledWith("pi_agent_session_forget", {
        sessionId: session.id,
      });
    });
  });

  describe("session rename", () => {
    it("updates the session title", async () => {
      const { session } = await webviewSession.webviewSessionCreate();

      const result = await webviewSession.webviewSessionRename(
        session.id,
        "Renamed",
      );

      expect(result.session.title).toBe("Renamed");
      expect(result.events[0].type).toBe(PI_SESSION_EVENT.Renamed);
    });
  });

  describe("session delete", () => {
    it("removes the session from memory", async () => {
      const { session } = await webviewSession.webviewSessionCreate();

      const result = await webviewSession.webviewSessionDelete(session.id);

      expect(result.events[0].type).toBe(PI_SESSION_EVENT.Deleted);
      expect(mockInvoke).toHaveBeenCalledWith("pi_agent_session_forget", {
        sessionId: session.id,
      });

      // Verify the session is gone
      await expect(
        webviewSession.webviewSessionDelete(session.id),
      ).rejects.toThrow();
    });
  });

  describe("session delete with artifacts", () => {
    it("attempts artifact cleanup via Rust", async () => {
      const { session } = await webviewSession.webviewSessionCreate();

      // Mock the artifact cleanup call to succeed
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "artifacts_delete_for_conversation") {
          return Promise.resolve({ deleted: [{}], deletedCount: 1 });
        }
        return Promise.resolve(undefined);
      });

      const result = await webviewSession.webviewSessionDeleteWithArtifacts(
        session.id,
      );

      expect(result.sessionDelete).toBeDefined();
      expect(result.artifactDelete).toEqual({
        deleted: true,
        deletedCount: 1,
      });
      expect(result.artifactCleanupError).toBeNull();
    });

    it("handles artifact cleanup errors gracefully", async () => {
      const { session } = await webviewSession.webviewSessionCreate();

      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "artifacts_delete_for_conversation") {
          return Promise.reject(new Error("Store error"));
        }
        return Promise.resolve(undefined);
      });

      const result = await webviewSession.webviewSessionDeleteWithArtifacts(
        session.id,
      );

      expect(result.sessionDelete).toBeDefined();
      expect(result.artifactDelete).toBeNull();
      expect(result.artifactCleanupError).toBe("Store error");
    });
  });

  describe("tool approval gate", () => {
    it("responds to tool approval requests", async () => {
      const { session } = await webviewSession.webviewSessionCreate();

      const result = await webviewSession.webviewSessionToolRespond(
        session.id,
        "call_123",
        true,
      );

      expect(result.events[0].type).toBe(
        PI_SESSION_EVENT.ToolApprovalResponded,
      );
      expect(result.events[0].payload).toEqual(
        expect.objectContaining({
          toolCallId: "call_123",
          approved: true,
        }),
      );
    });

    it("denies a pending approval when the session is stopped", async () => {
      let capturedGate:
        | ((t: string, c: string, i: unknown) => Promise<boolean>)
        | undefined;
      mockCreateTauriAgent.mockImplementation(
        (opts: {
          approvalGate?: (t: string, c: string, i: unknown) => Promise<boolean>;
        }) => {
          capturedGate = opts.approvalGate;
          return Promise.resolve({
            state: { messages: [], isStreaming: false },
            subscribe: vi.fn(() => vi.fn()),
            prompt: vi.fn(),
            abort: vi.fn(),
          });
        },
      );

      const { session } = await webviewSession.webviewSessionCreate(
        "A",
        "/ws",
        {
          provider: "anthropic",
          modelId: "m",
        } as never,
      );

      // bash_run resolves to "ask" (no manifest -> native default), so the gate
      // registers a pending approval and waits.
      const approval = capturedGate?.("bash_run", "call-1", {});
      await webviewSession.webviewSessionStop(session.id);

      await expect(approval).resolves.toBe(false);
    });

    it("emits correct event when tool is denied", async () => {
      const { session } = await webviewSession.webviewSessionCreate();

      const result = await webviewSession.webviewSessionToolRespond(
        session.id,
        "call_456",
        false,
      );

      expect(result.events[0].payload).toEqual(
        expect.objectContaining({
          toolCallId: "call_456",
          approved: false,
        }),
      );
    });
  });

  describe("fork and rollback transcript sync", () => {
    it("fork reconstructs and persists a transcript for the new session", async () => {
      const forkId = "fork_abc";
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "pi_session_fork") {
          return Promise.resolve({
            session: {
              id: forkId,
              title: "X (fork)",
              cwd: "/",
              status: "idle",
            },
            events: [],
          });
        }
        if (cmd === "pi_sessions_history") {
          return Promise.resolve({
            sessions: [{ id: forkId }],
            events: [
              {
                id: "e1",
                type: PI_SESSION_EVENT.Input,
                sessionId: forkId,
                createdAt: "2026-06-10T00:00:01.000Z",
                payload: { text: "hi" },
              },
              {
                id: "e2",
                type: PI_SESSION_EVENT.OutputText,
                sessionId: forkId,
                createdAt: "2026-06-10T00:00:02.000Z",
                payload: { text: "hello" },
              },
            ],
          });
        }
        return Promise.resolve(undefined);
      });

      const result = await webviewSession.webviewSessionFork("parent-1");

      expect(result.session.id).toBe(forkId);
      const recordCall = mockInvoke.mock.calls.find(
        ([cmd]) => cmd === "pi_store_record_transcript",
      );
      expect(recordCall?.[1].sessionId).toBe(forkId);
      const messages = deserializeAgentTranscript(recordCall?.[1].transcript);
      expect(messages.map((m) => (m as { role: string }).role)).toEqual([
        "user",
        "assistant",
      ]);
    });

    it("rollback persists a truncated transcript and keeps the session usable", async () => {
      const { session } = await webviewSession.webviewSessionCreate("R", "/ws");

      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "pi_session_rollback") {
          return Promise.resolve({
            session: { id: session.id, status: "idle" },
            removedEventCount: 2,
          });
        }
        if (cmd === "pi_sessions_history") {
          return Promise.resolve({
            sessions: [{ id: session.id, cwd: "/ws", status: "idle" }],
            events: [
              {
                id: "e1",
                type: PI_SESSION_EVENT.Input,
                sessionId: session.id,
                createdAt: "2026-06-10T00:00:01.000Z",
                payload: { text: "first prompt" },
              },
            ],
          });
        }
        if (cmd === "pi_store_load_transcript") {
          return Promise.resolve(
            serializeAgentTranscript([
              { role: "user", content: "first prompt", timestamp: 1 },
            ] as never),
          );
        }
        return Promise.resolve(undefined);
      });

      await webviewSession.webviewSessionRollback(session.id, "evt-x");

      const recordCall = mockInvoke.mock.calls.find(
        ([cmd]) => cmd === "pi_store_record_transcript",
      );
      expect(recordCall?.[1].sessionId).toBe(session.id);
      // The session remains usable (rehydrated in place), not evicted into a
      // "Session not found" hole.
      await expect(
        webviewSession.webviewSessionStop(session.id),
      ).resolves.toBeDefined();
    });
  });

  describe("session resume", () => {
    it("re-resolves skills and updates agent state", async () => {
      const { session } = await webviewSession.webviewSessionCreate();
      const agent = await mockCreateTauriAgent.mock.results[0].value;

      const result = await webviewSession.webviewSessionResume(session.id);

      expect(agent.state.systemPrompt).toBe("Test system prompt");
      expect(result.session.status).toBe("idle");
      expect(result.events[0].type).toBe(PI_SESSION_EVENT.Resumed);
    });

    it("applies a switched model to the live agent on resume", async () => {
      const { session } = await webviewSession.webviewSessionCreate(
        "Model switch",
        "/ws",
        {
          provider: "anthropic",
          modelId: "claude-sonnet-4-20250514",
        } as never,
      );
      const agent = await mockCreateTauriAgent.mock.results[0].value;

      await webviewSession.webviewSessionResume(session.id, {
        provider: "openai",
        modelId: "gpt-5",
      } as never);

      // The agent's active model is updated in place, not left on the old one.
      expect(agent.state.model).toEqual({ id: "gpt-5", provider: "openai" });
    });

    it("rebuilds the agent from the persisted transcript after a restart", async () => {
      // The session exists on disk but not in memory (fresh process).
      const sessionId = "restart-session-1";
      const transcript = serializeAgentTranscript([
        { role: "user", content: "hi", timestamp: 1 },
        {
          role: "assistant",
          content: [{ type: "text", text: "hello" }],
          api: "anthropic-messages",
          provider: "anthropic",
          model: "claude-sonnet-4",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: "stop",
          timestamp: 2,
        },
      ] as never);

      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "pi_sessions_history") {
          return Promise.resolve({
            sessions: [
              {
                id: sessionId,
                title: "Old",
                cwd: "/ws",
                status: "idle",
                createdAt: "t",
                updatedAt: "t",
                lastPrompt: null,
              },
            ],
            events: [],
          });
        }
        if (cmd === "pi_store_load_transcript") {
          return Promise.resolve(transcript);
        }
        return Promise.resolve(undefined);
      });

      const result = await webviewSession.webviewSessionResume(sessionId, {
        provider: "anthropic",
        modelId: "claude-sonnet-4-20250514",
      } as never);

      // A fresh agent was constructed and seeded with the stored transcript.
      expect(mockCreateTauriAgent).toHaveBeenCalled();
      const results = mockCreateTauriAgent.mock.results;
      const agent = await results[results.length - 1].value;
      expect(agent.state.messages).toHaveLength(2);
      expect(result.events[0].type).toBe(PI_SESSION_EVENT.Resumed);
    });
  });
});

describe("Pi session backend abstraction", () => {
  it("provides a backend that routes to the correct implementation", async () => {
    const { getSessionBackend } = await import(
      "@/modules/pi/lib/pi-session-backend"
    );
    const backend = getSessionBackend();

    expect(backend.sessionCreate).toBeInstanceOf(Function);
    expect(backend.sessionSend).toBeInstanceOf(Function);
    expect(backend.sessionStop).toBeInstanceOf(Function);
    expect(backend.sessionRename).toBeInstanceOf(Function);
    expect(backend.sessionDelete).toBeInstanceOf(Function);
    expect(backend.sessionDeleteWithArtifacts).toBeInstanceOf(Function);
    expect(backend.sessionToolRespond).toBeInstanceOf(Function);
    expect(backend.sessionResume).toBeInstanceOf(Function);
  });

  it("resets the cached backend", async () => {
    const { getSessionBackend, resetSessionBackend } = await import(
      "@/modules/pi/lib/pi-session-backend"
    );

    const backend1 = getSessionBackend();
    const backend2 = getSessionBackend();
    expect(backend1).toBe(backend2); // Same cached instance

    resetSessionBackend();
    // After reset, the resolver still returns the active backend shape.
    const backend3 = getSessionBackend();
    expect(backend3.sessionCreate).toBeInstanceOf(Function);
  });
});
