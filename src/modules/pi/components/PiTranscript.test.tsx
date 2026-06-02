import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PiTranscript } from "@/modules/pi/components/PiTranscript";
import type { PiSession, PiTranscriptItem } from "@/modules/pi/lib/sessions";

const session: PiSession = {
  id: "pi-1",
  title: "Pi Session 1",
  cwd: "/tmp/project",
  status: "idle",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastPrompt: null,
};

function item(
  id: string,
  kind: PiTranscriptItem["kind"],
  text: string,
): PiTranscriptItem {
  return {
    id,
    kind,
    label: kind === "assistant" ? "Pi" : "Prompt",
    text,
    eventIds: [id],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("PiTranscript", () => {
  it("keeps user and assistant transcript text selectable and breakable", () => {
    const html = renderToStaticMarkup(
      <PiTranscript
        selectedSession={session}
        transcript={[
          item("evt-1", "user", "copy this prompt"),
          item("evt-2", "assistant", "copy this response"),
        ]}
      />,
    );

    expect(html).toContain("select-text");
    expect(html).toContain("break-words");
    expect(html).not.toContain("wrap-break-word");
  });
});
