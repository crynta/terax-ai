import { describe, expect, it } from "vitest";
import {
  createWorkflowPiAgentExecutor,
  type WorkflowPiAgentEventListener,
} from "./nativeAgentExecution";
import { createWorkflowNode, type WorkflowDocument } from "./schema";

const document: WorkflowDocument = {
  id: "wf_native_agent",
  title: "Native agent",
  version: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  variables: [],
  artifacts: [],
  nodes: [],
  edges: [],
};
const node = createWorkflowNode({
  id: "node_agent",
  type: "agent",
  position: { x: 0, y: 0 },
});

function session(
  id: string,
  status: "error" | "idle" | "running" | "stopped" = "idle",
) {
  return {
    id,
    title: "Workflow Agent",
    status,
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
    lastPrompt: null,
  };
}

describe("native Pi workflow agent executor", () => {
  it("creates a Pi session, streams output events, and returns the final assistant text", async () => {
    const chunks: string[] = [];
    let listener: WorkflowPiAgentEventListener | null = null;
    const executor = createWorkflowPiAgentExecutor({
      listen: async (nextListener) => {
        listener = nextListener;
        return () => {
          listener = null;
        };
      },
      pi: {
        sessionCreate: async (_title, cwd, policy) => {
          expect(cwd).toBe("/repo");
          expect(policy).toEqual({
            approved: true,
            documentId: "wf_native_agent",
            nodeId: "node_agent",
            toolName: "workflow.agent_prompt",
          });
          return { session: session("pi-1"), events: [] };
        },
        sessionSend: async (sessionId, prompt) => {
          expect(sessionId).toBe("pi-1");
          expect(prompt).toBe("Review this");
          listener?.({
            id: "evt-delta",
            type: "session.output.delta",
            sessionId,
            createdAt: "2026-06-05T00:00:01.000Z",
            payload: { text: "Looks " },
          });
          return {
            accepted: true,
            session: session("pi-1"),
            events: [
              {
                id: "evt-final",
                type: "session.output.text",
                sessionId,
                createdAt: "2026-06-05T00:00:02.000Z",
                payload: { text: "Looks good" },
              },
            ],
          };
        },
        sessionStop: async () => {
          throw new Error("should not stop");
        },
      },
    });

    const output = await executor({
      document,
      node,
      prompt: "Review this",
      cwd: "/repo",
      reportOutput: (chunk) => chunks.push(chunk),
    });

    expect(chunks).toEqual(["Looks "]);
    expect(output).toEqual({
      text: "Looks good",
      sessionId: "pi-1",
      eventIds: ["evt-delta", "evt-final"],
    });
  });

  it("passes the selected Pi provider config to workflow session creation", async () => {
    const providerConfig = {
      authMode: "terax" as const,
      provider: "google",
      modelId: "gemini-2.5-flash",
      sourceModelId: "gemini-2.5-flash",
      contextLimit: 1_048_576,
      maxTokens: 1_048_576,
      reasoning: true,
    };
    const executor = createWorkflowPiAgentExecutor({
      providerConfig,
      listen: async () => () => undefined,
      pi: {
        sessionCreate: async (_title, _cwd, _policy, config) => {
          expect(config).toEqual(providerConfig);
          return { session: session("pi-provider"), events: [] };
        },
        sessionSend: async (sessionId) => ({
          accepted: true,
          session: session(sessionId),
          events: [],
        }),
        sessionStop: async () => {
          throw new Error("should not stop");
        },
      },
    });

    await expect(
      executor({
        document,
        node,
        prompt: "Use configured model",
        reportOutput: () => undefined,
      }),
    ).resolves.toMatchObject({ sessionId: "pi-provider" });
  });

  it("stops the Pi session when the workflow signal aborts", async () => {
    const controller = new AbortController();
    let listener: WorkflowPiAgentEventListener | null = null;
    const stopped: string[] = [];
    const executor = createWorkflowPiAgentExecutor({
      listen: async (nextListener) => {
        listener = nextListener;
        return () => {
          listener = null;
        };
      },
      pi: {
        sessionCreate: async () => ({
          session: session("pi-stop"),
          events: [],
        }),
        sessionSend: async (sessionId) => {
          listener?.({
            id: "evt-delta",
            type: "session.output.delta",
            sessionId,
            createdAt: "2026-06-05T00:00:01.000Z",
            payload: { text: "working" },
          });
          return { accepted: true, session: session(sessionId), events: [] };
        },
        sessionStop: async (sessionId) => {
          stopped.push(sessionId);
          return { session: session(sessionId, "stopped"), events: [] };
        },
      },
    });

    await expect(
      executor({
        document,
        node,
        prompt: "Review this",
        reportOutput: () => controller.abort(),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(stopped).toEqual(["pi-stop"]);
  });
});
