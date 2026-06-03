import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PiComposer } from "@/modules/pi/components/PiComposer";
import type { PiSession } from "@/modules/pi/lib/sessions";

const baseSession: PiSession = {
  id: "pi-1",
  title: "Pi Session 1",
  cwd: "/tmp/project",
  status: "idle",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastPrompt: null,
};

function renderComposer(session: PiSession, prompt = "hello") {
  return renderToStaticMarkup(
    <PiComposer
      disabled={false}
      isBusy={false}
      prompt={prompt}
      runtimeReady
      selectedSession={session}
      onPromptChange={vi.fn()}
      onSendPrompt={vi.fn()}
      onStopSession={vi.fn()}
    />,
  );
}

describe("PiComposer", () => {
  it("shows send as the primary action while a session is idle", () => {
    const html = renderComposer(baseSession);

    expect(html).toContain('aria-label="Send prompt"');
    expect(html).not.toContain('aria-label="Stop response"');
  });

  it("switches to the stop action while Pi is responding", () => {
    const html = renderComposer({ ...baseSession, status: "running" });

    expect(html).toContain('aria-label="Stop response"');
    expect(html).not.toContain('aria-label="Send prompt"');
  });

  it("surfaces prompt length when the host limit is close", () => {
    const html = renderComposer(baseSession, "x".repeat(19_950));

    expect(html).toContain("19,950/20,000");
  });

  it("does not silently truncate oversized pasted prompts", () => {
    const html = renderComposer(baseSession, "x".repeat(20_001));

    expect(html).toContain("20,001/20,000");
    expect(html).not.toContain("maxlength");
    expect(html).not.toContain("maxLength");
  });
});
