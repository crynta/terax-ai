/** @vitest-environment jsdom */
import type { UIMessage } from "@ai-sdk/react";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
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

const failedToolMessages = [
  {
    id: "user-2",
    role: "user",
    parts: [{ type: "text", text: "Run failing test" }],
  },
  {
    id: "assistant-2",
    role: "assistant",
    parts: [
      {
        type: "tool-bash_run",
        state: "output-error",
        input: { command: "pnpm test" },
        errorText: "exit status 1",
      },
    ],
  },
] as UIMessage[];

const multipleFailedToolMessages = [
  {
    id: "user-3",
    role: "user",
    parts: [{ type: "text", text: "Run multiple failures" }],
  },
  {
    id: "assistant-3",
    role: "assistant",
    parts: [
      {
        type: "tool-bash_run",
        state: "output-error",
        input: { command: "pnpm test" },
        errorText: "first failure",
      },
      {
        type: "tool-edit",
        state: "output-error",
        input: { path: "src/App.tsx" },
        errorText: "edit failed",
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

  it("collapses and expands timeline details from the header", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AgentRunTimeline
          messages={toolMessages}
          status="streaming"
          error={undefined}
          meta={{
            ...baseMeta,
            status: "streaming",
            step: "Running tests",
            runStartedAt: 1000,
            runEndedAt: 2000,
          }}
          onCancel={vi.fn()}
          onPause={vi.fn()}
          onRetry={vi.fn()}
          onResume={vi.fn()}
        />,
      );
    });

    const body = container.querySelector(
      "[data-testid='agent-run-timeline-body']",
    );
    const header = container.querySelector(
      "[data-testid='agent-run-timeline-toggle']",
    );

    expect(body).not.toBeNull();
    expect(header).not.toBeNull();

    await act(async () => {
      header?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(
      container.querySelector("[data-testid='agent-run-timeline-body']"),
    ).toBeNull();

    await act(async () => {
      header?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(
      container.querySelector("[data-testid='agent-run-timeline-body']"),
    ).not.toBeNull();

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("auto-expands the latest failed tool row by default", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AgentRunTimeline
          messages={failedToolMessages}
          status="ready"
          error={undefined}
          meta={{
            ...baseMeta,
            status: "idle",
            runStartedAt: 1000,
            runEndedAt: 2000,
          }}
          onCancel={vi.fn()}
          onPause={vi.fn()}
          onRetry={vi.fn()}
          onResume={vi.fn()}
        />,
      );
    });

    const failedBody = container.querySelector(
      "[data-testid='agent-run-timeline-tool-body-0']",
    );
    expect(failedBody).not.toBeNull();
    expect(failedBody?.textContent).toContain("Error");
    expect(failedBody?.textContent).toContain("exit status 1");

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("auto-expands only the newest failed tool and preserves manual collapse", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AgentRunTimeline
          messages={multipleFailedToolMessages}
          status="ready"
          error={undefined}
          meta={{
            ...baseMeta,
            status: "idle",
            runStartedAt: 1000,
            runEndedAt: 2000,
          }}
          onCancel={vi.fn()}
          onPause={vi.fn()}
          onRetry={vi.fn()}
          onResume={vi.fn()}
        />,
      );
    });

    const latestFailedBody = container.querySelector(
      "[data-testid='agent-run-timeline-tool-body-1']",
    );
    const earlierFailedBody = container.querySelector(
      "[data-testid='agent-run-timeline-tool-body-0']",
    );
    expect(latestFailedBody).not.toBeNull();
    expect(earlierFailedBody).toBeNull();

    const latestFailedToggle = container.querySelector(
      "[data-testid='agent-run-timeline-tool-toggle-1']",
    );
    expect(latestFailedToggle).not.toBeNull();

    await act(async () => {
      latestFailedToggle?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(
      container.querySelector("[data-testid='agent-run-timeline-tool-body-1']"),
    ).toBeNull();

    await act(async () => {
      root.render(
        <AgentRunTimeline
          messages={multipleFailedToolMessages}
          status="ready"
          error={undefined}
          meta={{
            ...baseMeta,
            status: "idle",
            runStartedAt: 1000,
            runEndedAt: 2000,
          }}
          onCancel={vi.fn()}
          onPause={vi.fn()}
          onRetry={vi.fn()}
          onResume={vi.fn()}
        />,
      );
    });

    expect(
      container.querySelector("[data-testid='agent-run-timeline-tool-body-1']"),
    ).toBeNull();

    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("expands and collapses tool call details", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AgentRunTimeline
          messages={toolMessages}
          status="ready"
          error={undefined}
          meta={{
            ...baseMeta,
            status: "idle",
            runStartedAt: 1000,
            runEndedAt: 2000,
          }}
          onCancel={vi.fn()}
          onPause={vi.fn()}
          onRetry={vi.fn()}
          onResume={vi.fn()}
        />,
      );
    });

    const toolToggle = container.querySelector(
      "[data-testid='agent-run-timeline-tool-toggle-0']",
    );
    expect(toolToggle).not.toBeNull();

    expect(
      container.querySelector("[data-testid='agent-run-timeline-tool-body-0']"),
    ).toBeNull();

    await act(async () => {
      toolToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const toolBody = container.querySelector(
      "[data-testid='agent-run-timeline-tool-body-0']",
    );
    expect(toolBody).not.toBeNull();
    expect(toolBody?.textContent).toContain("Input");
    expect(toolBody?.textContent).toContain("Output");

    await act(async () => {
      toolToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(
      container.querySelector("[data-testid='agent-run-timeline-tool-body-0']"),
    ).toBeNull();

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
