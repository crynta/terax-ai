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
    expect(html).toContain('data-streamdown="strong"');
    expect(html).toContain("Copy response");
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

  it("shows a thinking row while the selected session is running", () => {
    const html = renderToStaticMarkup(
      <PiTranscript
        selectedSession={sessionWithStatus("running")}
        transcript={[item({ id: "evt-1", kind: "user", text: "think" })]}
      />,
    );

    expect(html).toContain("Pi is thinking");
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
