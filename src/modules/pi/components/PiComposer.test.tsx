import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PiComposer } from "@/modules/pi/components/PiComposer";
import type { PiThinkingLevel } from "@/modules/pi/lib/provider";
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

function renderComposer(
  session: PiSession | null,
  prompt = "hello",
  contextUsage: {
    tokens: number | null;
    contextWindow: number | null;
    percent: number | null;
  } | null = null,
  thinking: { levels: PiThinkingLevel[]; level: PiThinkingLevel | null } = {
    levels: [],
    level: null,
  },
  options: {
    canCreateSession?: boolean;
    disabled?: boolean;
    isBusy?: boolean;
    runtimeReady?: boolean;
  } = {},
) {
  const {
    canCreateSession = true,
    disabled = false,
    isBusy = false,
    runtimeReady = true,
  } = options;

  return renderToStaticMarkup(
    <PiComposer
      availableThinkingLevels={thinking.levels}
      canCreateSession={canCreateSession}
      disabled={disabled}
      isBusy={isBusy}
      prompt={prompt}
      contextUsage={contextUsage}
      runtimeReady={runtimeReady}
      thinkingLevel={thinking.level}
      selectedSession={session}
      onCreateSession={vi.fn()}
      onPromptChange={vi.fn()}
      onRetryLastPrompt={vi.fn()}
      onSendPrompt={vi.fn()}
      onStopSession={vi.fn()}
      onThinkingLevelChange={vi.fn()}
    />,
  );
}

function thinkingSelect(html: string): string | undefined {
  return html.match(
    /<select[^>]*aria-label="Pi thinking level for next reply"[^>]*>/,
  )?.[0];
}

describe("PiComposer", () => {
  it("shows send as the primary action while a session is idle", () => {
    const html = renderComposer(baseSession);

    expect(html).toContain("Enter to send · Shift Enter for newline");
    expect(html).toContain('aria-label="Send prompt"');
    expect(html).not.toContain('aria-label="Stop response"');
  });

  it("asks users to start Pi before sending when the runtime is not ready", () => {
    const html = renderComposer(baseSession, "hello", null, undefined, {
      disabled: true,
      runtimeReady: false,
    });

    expect(html).toContain("Start Pi to send prompts.");
  });

  it("switches to the stop action while Pi is responding", () => {
    const html = renderComposer({ ...baseSession, status: "running" });

    expect(html).toContain(
      "Pi is responding. Stop it before sending another prompt.",
    );
    expect(html).toContain('aria-label="Stop response"');
    expect(html).not.toContain('aria-label="Send prompt"');
  });

  it("shows estimated context usage when available", () => {
    const html = renderComposer(baseSession, "hello", {
      tokens: 1_234,
      contextWindow: 128_000,
      percent: 0.96,
    });

    expect(html).toContain("Context 1,234 / 128,000");
    expect(html).toContain("1%");
  });

  it("shows zero percent for an empty model context", () => {
    const html = renderComposer(baseSession, "hello", {
      tokens: 0,
      contextWindow: 400_000,
      percent: 0,
    });

    expect(html).toContain("Context 0 / 400,000 0%");
    expect(html).not.toContain("Context 0 / 400,000 1%");
  });

  it("shows thinking selector for reasoning-capable models", () => {
    const html = renderComposer(baseSession, "hello", null, {
      levels: ["off", "minimal", "low", "medium", "high", "xhigh"],
      level: "high",
    });

    expect(html).toContain('aria-label="Pi thinking level for next reply"');
    expect(thinkingSelect(html)).toContain('title="Applies to next reply"');
    expect(html).toContain('value="high" selected=""');
    expect(html).toContain("Thinking");
  });

  it("keeps thinking selectable without a session so it can seed the next session", () => {
    const html = renderComposer(
      null,
      "",
      null,
      {
        levels: ["off", "minimal", "low", "medium", "high", "xhigh"],
        level: "medium",
      },
      { disabled: true },
    );
    const select = thinkingSelect(html);

    expect(select).toBeDefined();
    expect(select).not.toMatch(/\sdisabled(?:=|\s|>)/);
    expect(select).toContain('title="Applies to next reply"');
  });

  it("locks thinking while the selected session is running", () => {
    const html = renderComposer(
      { ...baseSession, status: "running" },
      "hello",
      null,
      {
        levels: ["off", "minimal", "low", "medium", "high", "xhigh"],
        level: "high",
      },
    );
    const select = thinkingSelect(html);

    expect(select).toBeDefined();
    expect(select).toMatch(/\sdisabled(?:=|\s|>)/);
    expect(select).toContain('title="Locked during run"');
  });

  it("explains when thinking is locked by another Pi action", () => {
    const html = renderComposer(
      baseSession,
      "hello",
      null,
      {
        levels: ["off", "minimal", "low", "medium", "high", "xhigh"],
        level: "high",
      },
      { isBusy: true },
    );
    const select = thinkingSelect(html);

    expect(select).toBeDefined();
    expect(select).toMatch(/\sdisabled(?:=|\s|>)/);
    expect(select).toContain('title="Wait for current action"');
  });

  it("hides thinking selector when the model has no thinking levels", () => {
    const html = renderComposer(baseSession);

    expect(html).not.toContain('aria-label="Pi thinking level"');
  });

  it("keeps oversized pasted prompts scrollable inside the composer", () => {
    const html = renderComposer(baseSession, "x".repeat(19_950));

    expect(html).toContain("max-h-32");
    expect(html).toContain("overflow-y-auto");
  });

  it("surfaces prompt length when the host limit is close", () => {
    const html = renderComposer(baseSession, "x".repeat(19_950));

    expect(html).toContain("19,950/20,000");
  });

  it("does not silently truncate oversized pasted prompts", () => {
    const html = renderComposer(baseSession, "x".repeat(20_001));

    expect(html).toContain("Prompt is over 20,000 characters.");
    expect(html).toContain("20,001/20,000");
    expect(html).toContain("text-destructive");
    expect(html).not.toContain("maxlength");
    expect(html).not.toContain("maxLength");
  });

  it("offers a new-session recovery action for stopped sessions", () => {
    const html = renderComposer({ ...baseSession, status: "stopped" }, "");

    expect(html).toContain("This session is stopped");
    expect(html).toContain('aria-label="Create new Pi session"');
    expect(html).toContain("New session");
    expect(html).not.toContain('aria-label="Send prompt"');
  });

  it("offers an inline retry action for errored sessions with a last prompt", () => {
    const html = renderComposer(
      { ...baseSession, status: "error", lastPrompt: "Why did Pi fail?" },
      "",
    );

    expect(html).toContain("Pi hit an error");
    expect(html).toContain('aria-label="Retry last Pi prompt"');
    expect(html).toContain("Retry last");
  });
});
