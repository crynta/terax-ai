import { describe, expect, it } from "vitest";
import {
  EMPTY_QUEUE,
  enqueue,
  pauseQueue,
  readyToSend,
  resumeQueue,
  sendDecision,
} from "./promptQueue";
import { appendDictation, cleanTranscript, pickSpeechLanguage } from "./speech";
import {
  FORCE_AFTER_MS,
  pressStop,
  STOP_IDLE,
  STOPPED_SHOW_MS,
  stopLabel,
  tickStop,
} from "./stopControl";

const item = (id: string, text = id) => ({
  id,
  text,
  mentions: [],
  images: [],
});

describe("always-active composer", () => {
  it("queues while a question is on screen, even with Cmd+Enter", () => {
    expect(sendDecision({ working: false, dialog: true, steer: false })).toBe(
      "queueAfterDialog",
    );
    expect(sendDecision({ working: true, dialog: true, steer: true })).toBe(
      "queueAfterDialog",
    );
  });

  it("queues while working unless steering, and sends when idle", () => {
    expect(sendDecision({ working: true, dialog: false, steer: false })).toBe(
      "queue",
    );
    expect(sendDecision({ working: true, dialog: false, steer: true })).toBe(
      "send",
    );
    expect(sendDecision({ working: false, dialog: false, steer: false })).toBe(
      "send",
    );
  });

  it("a queued message waits for the dialog to go, then settles", () => {
    const q = enqueue(EMPTY_QUEUE, { ...item("a"), afterDialog: true });
    const base = {
      phase: "finished" as const,
      activityWorking: false,
      now: 10_000,
    };
    expect(readyToSend(q, { ...base, dialog: true, idleSince: 0 })).toBe(false);
    expect(readyToSend(q, { ...base, dialog: false, idleSince: 9_500 })).toBe(
      false,
    );
    expect(readyToSend(q, { ...base, dialog: false, idleSince: 8_000 })).toBe(
      true,
    );
  });

  it("a paused queue holds until resumed", () => {
    const q = pauseQueue(enqueue(EMPTY_QUEUE, item("a")));
    const idle = {
      phase: "finished" as const,
      dialog: false,
      activityWorking: false,
      idleSince: 0,
      now: 10_000,
    };
    expect(readyToSend(q, idle)).toBe(false);
    expect(readyToSend(resumeQueue(q), idle)).toBe(true);
    expect(pauseQueue(q)).toBe(q);
  });
});

describe("stop control", () => {
  it("sends Esc once, offers Force stop after the delay, then stops", () => {
    const first = pressStop(STOP_IDLE, 0);
    expect(first.sendEsc).toBe(true);
    expect(stopLabel(first.state)).toBe("Stopping…");
    // A second press while stopping doesn't stack another Esc.
    expect(pressStop(first.state, 100).sendEsc).toBe(false);
    const stillWorking = tickStop(first.state, FORCE_AFTER_MS - 1, true);
    expect(stillWorking.kind).toBe("stopping");
    const force = tickStop(first.state, FORCE_AFTER_MS, true);
    expect(stopLabel(force)).toBe("Force stop");
    const forced = pressStop(force, FORCE_AFTER_MS + 10);
    expect(forced.sendEsc).toBe(true);
    expect(forced.state).toMatchObject({ kind: "stopping", presses: 2 });
    const stopped = tickStop(forced.state, FORCE_AFTER_MS + 200, false);
    expect(stopLabel(stopped)).toBe("Stopped");
    expect(
      tickStop(stopped, FORCE_AFTER_MS + 200 + STOPPED_SHOW_MS, false),
    ).toEqual(STOP_IDLE);
  });

  it("stops at once when Claude goes idle", () => {
    const { state } = pressStop(STOP_IDLE, 0);
    expect(tickStop(state, 50, false).kind).toBe("stopped");
    expect(tickStop(STOP_IDLE, 50, true)).toBe(STOP_IDLE);
  });
});

describe("speech clean-up", () => {
  it("turns spoken punctuation into marks and fixes spacing", () => {
    expect(cleanTranscript("hello world comma how are you question mark")).toBe(
      "Hello world, how are you?",
    );
    expect(cleanTranscript("first line new line second line")).toBe(
      "First line\nSecond line",
    );
    expect(cleanTranscript("i think so full stop it works")).toBe(
      "I think so. It works",
    );
    expect(cleanTranscript("   ")).toBe("");
  });

  it("joins phrases onto the draft with sensible spacing and capitals", () => {
    expect(appendDictation("", "fix the test")).toBe("Fix the test");
    expect(appendDictation("Fix the test", "in the reader")).toBe(
      "Fix the test in the reader",
    );
    expect(appendDictation("Fix the test.", "then build")).toBe(
      "Fix the test. Then build",
    );
    expect(appendDictation("Fix the test", "comma please")).toBe(
      "Fix the test, please",
    );
    expect(appendDictation("draft  ", "  ")).toBe("draft  ");
  });

  it("picks an offered language", () => {
    expect(pickSpeechLanguage("en-IN")).toBe("en-IN");
    expect(pickSpeechLanguage("hi")).toBe("hi-IN");
    expect(pickSpeechLanguage("en-GB")).toBe("en-IN");
    expect(pickSpeechLanguage("fr-FR")).toBe("en-US");
    expect(pickSpeechLanguage(undefined)).toBe("en-US");
  });
});
