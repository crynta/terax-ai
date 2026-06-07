import type { UIMessage } from "@ai-sdk/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AgentMeta, useChatStore } from "../store/chatStore";
import {
  AgentRunTimeline,
  AiChatView,
  selectRecentAgentRuns,
  summarizeAgentToolActivity,
} from "./AiChat";

const toolMessages = [
  {
    id: "user-1",
    role: "user",
    parts: [{ type: "text", text: "Run the tests" }],
  },
  {
    id: "assistant-1",
    role: "assistant",
    parts: [
      {
        type: "tool-bash_run",
        state: "output-available",
        input: { command: "pnpm test" },
        output: "ok",
      },
      {
        type: "tool-edit",
        state: "approval-requested",
        input: { path: "src/App.tsx" },
        approval: { id: "approval-1" },
      },
    ],
  },
] as UIMessage[];

function noop() {}

const baseMeta: AgentMeta = {
  status: "idle",
  step: null,
  approvalsPending: 0,
  error: null,
  tokens: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
  lastInputTokens: 0,
  lastCachedTokens: 0,
  hitStepCap: false,
  compactionNotice: null,
  runStartedAt: null,
  runEndedAt: null,
  stopReason: null,
};

describe("AiChatView agent timeline", () => {
  beforeEach(() => {
    useChatStore.setState({ activeSessionId: null });
    useChatStore.getState().resetAgentMeta();
    useChatStore.getState().clearAgentRunHistory();
  });

  it("summarizes tool activity for the run timeline", () => {
    expect(summarizeAgentToolActivity(toolMessages)).toEqual(
      expect.objectContaining({
        total: 2,
        completed: 1,
        running: 0,
        awaitingApproval: 1,
        failed: 0,
        latestToolName: "edit",
        items: [
          expect.objectContaining({
            name: "bash_run",
            status: "done",
            detail: "pnpm test",
          }),
          expect.objectContaining({
            name: "edit",
            status: "awaiting",
            detail: "src/App.tsx",
          }),
        ],
      }),
    );
  });

  it("renders timeline status, tool counts, and cancellation affordance", () => {
    const html = renderToStaticMarkup(
      <AgentRunTimeline
        messages={toolMessages}
        status="streaming"
        error={undefined}
        meta={{
          ...baseMeta,
          status: "streaming",
          step: "Running tests",
          runStartedAt: 1000,
        }}
        onCancel={vi.fn()}
        onPause={vi.fn()}
        onRetry={vi.fn()}
        onResume={vi.fn()}
      />,
    );

    expect(html).toContain("Run timeline");
    expect(html).toContain("Awaiting approval");
    expect(html).toContain("Running tests");
    expect(html).toContain("2 tools");
    expect(html).toContain("1 done");
    expect(html).toContain("1 needs approval");
    expect(html).toContain("Pause");
    expect(html).toContain("Cancel");
    expect(html).toContain("pnpm test");
    expect(html).toContain("src/App.tsx");
  });

  it("renders recovery actions after an error or cancellation", () => {
    useChatStore.getState().patchAgentMeta({
      status: "error",
      runStartedAt: 1000,
      runEndedAt: 2000,
      stopReason: "error",
    });
    const errorHtml = renderToStaticMarkup(
      <AiChatView
        messages={toolMessages}
        status="error"
        error={new Error("network failed")}
        clearError={noop}
        addToolApprovalResponse={noop}
        stop={noop}
      />,
    );
    expect(errorHtml).toContain("Retry");

    const cancelledHtml = renderToStaticMarkup(
      <AgentRunTimeline
        messages={[]}
        status="ready"
        error={undefined}
        meta={{
          ...baseMeta,
          runStartedAt: 1000,
          runEndedAt: 2000,
          stopReason: "cancelled",
        }}
        onCancel={noop}
        onPause={noop}
        onRetry={noop}
        onResume={noop}
      />,
    );
    expect(cancelledHtml).toContain("Cancelled");
    expect(cancelledHtml).toContain("Retry");

    const pausedHtml = renderToStaticMarkup(
      <AgentRunTimeline
        messages={[]}
        status="ready"
        error={undefined}
        meta={{
          ...baseMeta,
          runStartedAt: 1000,
          runEndedAt: 2000,
          stopReason: "paused",
        }}
        onCancel={noop}
        onPause={noop}
        onRetry={noop}
        onResume={noop}
      />,
    );
    expect(pausedHtml).toContain("Paused");
    expect(pausedHtml).toContain("Resume");
  });

  it("filters persisted recent run history to the active session", () => {
    const recentRuns = selectRecentAgentRuns(
      [
        {
          id: "run-1",
          sessionId: "session-1",
          startedAt: 1000,
          endedAt: 3000,
          stopReason: "paused",
          step: "Editing files",
          error: null,
        },
        {
          id: "run-2",
          sessionId: "session-2",
          startedAt: 1000,
          endedAt: 2000,
          stopReason: "completed",
          step: "Other session",
          error: null,
        },
      ],
      "session-1",
    );

    expect(recentRuns).toHaveLength(1);
    expect(recentRuns[0]).toEqual(
      expect.objectContaining({ stopReason: "paused", step: "Editing files" }),
    );
  });
});
