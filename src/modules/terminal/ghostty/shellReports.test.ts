import { readFile } from "node:fs/promises";
import { TeraxGhostty } from "@terax/ghostty-core/adapted";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GhosttySemanticEventRouter } from "./core/GhosttySemanticEventRouter";
import {
  PROMPT_PRESENTATION_MISSING_MS,
  PROMPT_PRESENTATION_WATCHDOG_MS,
  PromptPresentationGate,
} from "./core/PromptPresentationGate";

vi.mock("@/lib/platform", () => ({ IS_WINDOWS: true }));

let ghostty: TeraxGhostty;

beforeAll(async () => {
  const file = await readFile(
    new URL(
      "../../../../packages/ghostty-core/adapted/ghostty-vt.wasm",
      import.meta.url,
    ),
  );
  ghostty = await TeraxGhostty.loadBytes(Uint8Array.from(file).buffer);
});

afterEach(() => vi.useRealTimers());

function replay(stream: string) {
  const terminal = ghostty.createTerminal(80, 24);
  try {
    terminal.write(new TextEncoder().encode(stream));
    return terminal.drainEvents();
  } finally {
    terminal.dispose();
  }
}

describe("shell integration streams through the real parser", () => {
  it("reports the directory of a cmd.exe PROMPT, spaces and backslashes included", () => {
    const cwds: string[] = [];
    const router = new GhosttySemanticEventRouter({
      onCwd: (cwd) => cwds.push(cwd),
    });
    for (const event of replay(
      "\x1b]7;file://BOX/C:\\Users\\me\\My Docs\x1b\\C:\\Users\\me\\My Docs>",
    )) {
      router.handle(event);
    }
    expect(cwds).toEqual(["C:/Users/me/My Docs"]);
  });

  it("releases a powerlevel10k style prompt as soon as the late prompt end arrives", () => {
    vi.useFakeTimers();
    const release = vi.fn();
    const gate = new PromptPresentationGate(release);
    // precmd: D, OSC 7, A. The line editor draws the prompt, then line-init: B.
    for (const event of replay(
      "\x1b]133;D;0\x1b\\\x1b]7;file://host/tmp\x1b\\\x1b]133;A\x1b\\",
    )) {
      gate.observe(event);
    }
    expect(gate.suppressed).toBe(true);
    for (const event of replay(" ~  > \x1b]133;B\x1b\\")) gate.observe(event);
    expect(gate.suppressed).toBe(false);
    expect(release).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops holding every prompt for a second when a shell never sends the prompt end", () => {
    vi.useFakeTimers();
    const gate = new PromptPresentationGate(() => {});
    const held: number[] = [];
    for (let prompt = 0; prompt < 5; prompt += 1) {
      for (const event of replay("\x1b]133;D;0\x1b\\\x1b]133;A\x1b\\")) {
        gate.observe(event);
      }
      let waited = 0;
      while (gate.suppressed) {
        vi.advanceTimersByTime(1);
        waited += 1;
      }
      held.push(waited);
    }
    expect(held[0]).toBe(PROMPT_PRESENTATION_WATCHDOG_MS);
    expect(held.slice(2)).toEqual([
      PROMPT_PRESENTATION_MISSING_MS,
      PROMPT_PRESENTATION_MISSING_MS,
      PROMPT_PRESENTATION_MISSING_MS,
    ]);
    expect(held.reduce((a, b) => a + b, 0)).toBeLessThan(1_400);
  });
});
