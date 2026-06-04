import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PiTranscript } from "@/modules/pi/components/PiTranscript";
import type {
  PiPromptContext,
  PiSession,
  PiTranscriptItem,
} from "@/modules/pi/lib/sessions";

const session: PiSession = {
  id: "pi-1",
  title: "Pi Session 1",
  cwd: "/tmp/project",
  status: "idle",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastPrompt: null,
};

function sessionWithStatus(status: PiSession["status"]): PiSession {
  return { ...session, status };
}

function item({
  id,
  kind,
  text,
  context,
}: {
  id: string;
  kind: PiTranscriptItem["kind"];
  text: string | null;
  context?: PiPromptContext;
}): PiTranscriptItem {
  return {
    id,
    kind,
    label: kind === "assistant" ? "Pi" : "Prompt",
    text,
    eventIds: [id],
    createdAt: "2026-01-01T00:00:00.000Z",
    context,
  } as PiTranscriptItem;
}

describe("PiTranscript", () => {
  it("renders Code chat surface actions when handlers are provided", () => {
    const html = renderToStaticMarkup(
      <PiTranscript
        selectedSession={session}
        transcript={[]}
        onOpenWorkspace={() => {}}
        onPopOut={() => {}}
      />,
    );

    expect(html).toContain('aria-label="Pop out Code chat"');
    expect(html).toContain('aria-label="Open Code chat in workspace"');
  });

  it("keeps user and assistant transcript text selectable and breakable", () => {
    const html = renderToStaticMarkup(
      <PiTranscript
        selectedSession={session}
        transcript={[
          item({ id: "evt-1", kind: "user", text: "copy this prompt" }),
          item({
            id: "evt-2",
            kind: "assistant",
            text: "copy this response",
          }),
        ]}
      />,
    );

    expect(html).toContain("select-text");
    expect(html).toContain("break-words");
    expect(html).not.toContain("wrap-break-word");
  });

  it("uses the shared conversation shell and markdown response renderer", () => {
    const html = renderToStaticMarkup(
      <PiTranscript
        selectedSession={session}
        transcript={[
          item({
            id: "evt-1",
            kind: "assistant",
            text: "**Bold** answer with `code`.",
          }),
        ]}
      />,
    );

    expect(html).toContain('role="log"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-relevant="additions text"');
    expect(html).toContain('data-streamdown="strong"');
    expect(html).toContain("Copy response");
  });

  it("renders assistant reasoning with the shared reasoning disclosure", () => {
    const html = renderToStaticMarkup(
      <PiTranscript
        selectedSession={sessionWithStatus("running")}
        transcript={[
          {
            ...item({ id: "evt-1", kind: "assistant", text: null }),
            reasoningText: "Checked the imports first.",
          },
        ]}
      />,
    );

    expect(html).toContain("Thinking");
    expect(html).toContain("Checked the imports first.");
    expect(html).toContain("select-text");
  });

  it("uses the active branch reasoning with branch controls", () => {
    const html = renderToStaticMarkup(
      <PiTranscript
        canRegenerate
        selectedSession={sessionWithStatus("running")}
        transcript={[
          {
            ...item({ id: "evt-1", kind: "assistant", text: null }),
            branchGroupId: "turn-1",
            promptText: "explain",
            branches: [
              {
                id: "evt-2",
                branchIndex: 0,
                text: "old answer",
                reasoningText: "old reasoning",
                eventIds: ["evt-2"],
                createdAt: "2026-01-01T00:00:00.000Z",
              },
              {
                id: "evt-3",
                branchIndex: 1,
                text: null,
                reasoningText: "new reasoning",
                eventIds: ["evt-3"],
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          },
        ]}
        onRegenerate={() => {}}
      />,
    );

    expect(html).toContain("new reasoning");
    expect(html).not.toContain("old reasoning");
    expect(html).toContain("Version 2 of 2");
  });

  it("renders approval requests with approval-gated actions", () => {
    const html = renderToStaticMarkup(
      <PiTranscript
        selectedSession={sessionWithStatus("running")}
        transcript={[
          {
            ...item({ id: "evt-1", kind: "tool", text: null }),
            label: "bash",
            toolCallId: "call-1",
            toolName: "bash",
            toolInput: { command: "pnpm test" },
            toolState: "approval-requested",
          },
        ]}
        onToolApproval={() => {}}
      />,
    );

    expect(html).toContain("Run shell command needs approval");
    expect(html).toContain("Deny");
    expect(html).toContain("Approve");
    expect(html).not.toContain("Approval actions are unavailable");
  });

  it("renders completed tool output without approval buttons", () => {
    const html = renderToStaticMarkup(
      <PiTranscript
        selectedSession={session}
        transcript={[
          {
            ...item({ id: "evt-1", kind: "tool", text: null }),
            label: "read",
            toolCallId: "call-1",
            toolName: "read",
            toolInput: { path: "package.json" },
            toolOutput: { content: '{"name":"terax"}', details: null },
            toolState: "output-available",
          },
        ]}
      />,
    );

    expect(html).toContain("Read");
    expect(html).toContain("package.json");
    expect(html).toContain("terax");
    expect(html).not.toContain("needs approval");
  });

  it("shows live progress from Pi session events", () => {
    const html = renderToStaticMarkup(
      <PiTranscript
        selectedSession={sessionWithStatus("running")}
        transcript={[
          item({ id: "evt-1", kind: "user", text: "think" }),
          item({
            id: "evt-2",
            kind: "progress",
            text: "Preparing model request…",
          }),
        ]}
      />,
    );

    expect(html).toContain("Preparing model request…");
    expect(html).toContain('role="status"');
  });

  it("does not reuse stale progress from an earlier turn", () => {
    const html = renderToStaticMarkup(
      <PiTranscript
        selectedSession={sessionWithStatus("running")}
        transcript={[
          item({ id: "evt-1", kind: "user", text: "first" }),
          item({ id: "evt-2", kind: "progress", text: "Writing response…" }),
          item({ id: "evt-3", kind: "assistant", text: "done" }),
          item({ id: "evt-4", kind: "user", text: "second" }),
        ]}
      />,
    );

    expect(html).toContain("Pi is thinking…");
    expect(html).not.toContain("Writing response…");
  });

  it("announces copy status and exposes copy failure wording", () => {
    const html = renderToStaticMarkup(
      <PiTranscript
        selectedSession={session}
        transcript={[item({ id: "evt-1", kind: "assistant", text: "copy me" })]}
      />,
    );

    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Copy failed");
  });

  it("keeps routine session events out of the chat transcript", () => {
    const html = renderToStaticMarkup(
      <PiTranscript
        selectedSession={session}
        transcript={[
          item({ id: "evt-1", kind: "system", text: null }),
          item({ id: "evt-2", kind: "system", text: "running" }),
          item({ id: "evt-3", kind: "user", text: "hello" }),
        ]}
      />,
    );

    expect(html).not.toContain(">Created<");
    expect(html).not.toContain(">Status<");
    expect(html).toContain("hello");
  });

  it("windows very large transcripts to keep the sidebar responsive", () => {
    const transcript = Array.from({ length: 180 }, (_, index) =>
      item({
        id: `evt-${index + 1}`,
        kind: index % 2 === 0 ? "user" : "assistant",
        text:
          index === 0
            ? "oldest-message"
            : index === 179
              ? "latest-message"
              : `middle-message-${index + 1}`,
      }),
    );

    const html = renderToStaticMarkup(
      <PiTranscript selectedSession={session} transcript={transcript} />,
    );

    expect(html).toContain("Showing latest 160 of 180 messages");
    expect(html).not.toContain("oldest-message");
    expect(html).toContain("latest-message");
  });

  it("shows prompt context and copy affordances for user messages", () => {
    const html = renderToStaticMarkup(
      <PiTranscript
        selectedSession={session}
        transcript={[
          item({
            id: "evt-1",
            kind: "user",
            text: "where is this defined?",
            context: {
              workspaceRoot: "/Users/me/project",
              activeFile: "/Users/me/project/src/App.tsx",
              activeTerminalCwd: "/Users/me/project/src",
              activeTerminalPrivate: true,
            },
          }),
        ]}
      />,
    );

    expect(html).toContain("Context sent");
    expect(html).toContain("App.tsx");
    expect(html).toContain("Private terminal");
    expect(html).toContain("Copy prompt");
  });

  it("shows a visible regenerate action for normal assistant responses", () => {
    const html = renderToStaticMarkup(
      <PiTranscript
        canRegenerate
        selectedSession={session}
        transcript={[
          item({ id: "evt-1", kind: "user", text: "explain" }),
          {
            ...item({ id: "evt-2", kind: "assistant", text: "answer" }),
            branchGroupId: "evt-1",
            branchIndex: 0,
            promptText: "explain",
            branches: [
              {
                id: "evt-2",
                branchIndex: 0,
                text: "answer",
                eventIds: ["evt-2"],
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          },
        ]}
        onRegenerate={() => {}}
      />,
    );

    expect(html).toContain("Regenerate");
    expect(html).toContain("Regenerate response");
  });

  it("shows branch controls and a regenerate action for regenerated responses", () => {
    const html = renderToStaticMarkup(
      <PiTranscript
        canRegenerate
        selectedSession={session}
        transcript={[
          item({ id: "evt-1", kind: "user", text: "explain" }),
          {
            ...item({ id: "evt-2", kind: "assistant", text: "new answer" }),
            branchGroupId: "turn-1",
            promptText: "explain",
            branches: [
              {
                id: "evt-2",
                branchIndex: 0,
                text: "old answer",
                eventIds: ["evt-2"],
                createdAt: "2026-01-01T00:00:00.000Z",
              },
              {
                id: "evt-4",
                branchIndex: 1,
                text: "new answer",
                eventIds: ["evt-4"],
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          },
        ]}
        onRegenerate={() => {}}
      />,
    );

    expect(html).toContain("Previous branch");
    expect(html).toContain("Next branch");
    expect(html).toContain("2 of 2");
    expect(html).toContain("Regenerate response");
    expect(html).toContain("new answer");
    expect(html).not.toContain("old answer");
  });

  it("keeps three-way branch controls compact and on the latest version", () => {
    const html = renderToStaticMarkup(
      <PiTranscript
        canRegenerate
        selectedSession={session}
        transcript={[
          {
            ...item({ id: "evt-2", kind: "assistant", text: "third answer" }),
            branchGroupId: "turn-1",
            promptText: "explain",
            branches: [
              {
                id: "evt-2",
                branchIndex: 0,
                text: "first answer",
                eventIds: ["evt-2"],
                createdAt: "2026-01-01T00:00:00.000Z",
              },
              {
                id: "evt-3",
                branchIndex: 1,
                text: "second answer",
                eventIds: ["evt-3"],
                createdAt: "2026-01-01T00:00:00.000Z",
              },
              {
                id: "evt-4",
                branchIndex: 2,
                text: "third answer",
                eventIds: ["evt-4"],
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          },
        ]}
        onRegenerate={() => {}}
      />,
    );

    expect(html).toContain("Version 3 of 3");
    expect(html).toContain("third answer");
    expect(html).not.toContain("first answer");
    expect(html).not.toContain("second answer");
  });

  it("shows a thinking row while the selected session is running", () => {
    const html = renderToStaticMarkup(
      <PiTranscript
        selectedSession={sessionWithStatus("running")}
        transcript={[item({ id: "evt-1", kind: "user", text: "think" })]}
      />,
    );

    expect(html).toContain("Pi is thinking");
    expect(html).toContain('role="status"');
  });

  it("offers keyboard-focusable prompt suggestions in the empty state", () => {
    const html = renderToStaticMarkup(
      <PiTranscript selectedSession={session} transcript={[]} />,
    );

    expect(html).toContain("Explain this project");
    expect(html).toContain("Summarize current file");
    expect(html).toContain("focus-visible:ring-2");
  });
});
