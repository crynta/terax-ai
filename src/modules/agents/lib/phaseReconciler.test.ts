import { describe, expect, it } from "vitest";
import {
  DONE_READS,
  GONE_READS,
  readScreen,
  reconcilePhase,
  type ScreenRead,
} from "./phaseReconciler";

const box = (...above: string[]) =>
  [
    ...above,
    "",
    "─────────────────────────────── notes ─",
    "❯ ",
    "────────────────────────────────────────",
    "  Opus 5.5 | 📁 Notes",
    "  ⏵⏵ auto mode on (shift+tab to cycle)",
  ].join("\n");

const WORKING = box(
  "⏺ Running the build.",
  "",
  "✶ Compiling… (1m 5s · ↓ 22k tokens · esc to interrupt)",
);
const COOKED = box("⏺ Built.", "", "✻ Cooked for 14m 37s · done 11:45 PM");
const INTERRUPTED = box("⏺ Running the build.", "  ⎿  Interrupted · What should Claude do instead?");
const PERMISSION = [
  "● I'll check the working tree.",
  "",
  "╭──────────────────────────────────────────────────────────────╮",
  "│ Bash command                                                 │",
  "│                                                              │",
  "│   git status --short                                         │",
  "│                                                              │",
  "│ Do you want to proceed?                                      │",
  "│ ❯ 1. Yes                                                     │",
  "│   2. No, and tell Claude what to do differently (esc)        │",
  "╰──────────────────────────────────────────────────────────────╯",
  "",
].join("\n");
const SHELL = "~/repo main ❯ ls\nREADME.md  src\n~/repo main ❯ ";

/** Feeds the same screen `n` times from `phase`, as the timer would. */
function settle(phase: "working" | "attention" | "idle", read: ScreenRead, n: number) {
  let quiet = 0;
  for (let i = 0; i < n; i++) {
    const next = reconcilePhase(phase, read, quiet);
    if (next.phase) return { phase: next.phase, reads: i + 1 };
    quiet = next.quietReads;
  }
  return { phase: null, reads: n };
}

describe("readScreen", () => {
  it("tells work, a finished turn, a dialog and Claude's absence apart", () => {
    expect(readScreen(WORKING)).toEqual({ busy: true, done: false, footer: true, dialog: false });
    expect(readScreen(COOKED)).toMatchObject({ busy: false, done: true });
    expect(readScreen(INTERRUPTED)).toMatchObject({ busy: false, footer: true });
    expect(readScreen(PERMISSION).dialog).toBe(true);
    expect(readScreen(SHELL)).toEqual({ busy: false, done: false, footer: false, dialog: false });
  });
});

describe("reconcilePhase", () => {
  it("drops 'working' once a finished turn shows twice in a row", () => {
    expect(settle("working", readScreen(COOKED), 5)).toEqual({ phase: "finished", reads: DONE_READS });
  });

  it("drops 'working' after an Esc interrupt, which fires no hook", () => {
    expect(settle("working", readScreen(INTERRUPTED), 5).phase).toBe("finished");
  });

  it("waits longer when Claude's screen is gone (it exited)", () => {
    expect(settle("working", readScreen(SHELL), 10)).toEqual({ phase: "finished", reads: GONE_READS });
  });

  it("does not flip on a single quiet read", () => {
    const first = reconcilePhase("working", readScreen(COOKED), 0);
    expect(first.phase).toBeNull();
    // Work shows again: the count starts over.
    const busy = reconcilePhase("working", readScreen(WORKING), first.quietReads);
    expect(busy).toEqual({ phase: null, quietReads: 0 });
  });

  it("shows work the hooks missed, e.g. after a permission answer", () => {
    expect(reconcilePhase("attention", readScreen(WORKING), 0).phase).toBe("working");
    expect(reconcilePhase("idle", readScreen(WORKING), 0).phase).toBe("working");
  });

  it("raises a dialog seen mid-turn, but never re-raises an acknowledged one", () => {
    expect(reconcilePhase("working", readScreen(PERMISSION), 0).phase).toBe("attention");
    expect(reconcilePhase("idle", readScreen(PERMISSION), 0).phase).toBeNull();
  });

  it("leaves idle sessions alone", () => {
    expect(reconcilePhase("idle", readScreen(COOKED), 0).phase).toBeNull();
    expect(reconcilePhase("finished", readScreen(SHELL), 0).phase).toBeNull();
  });
});
