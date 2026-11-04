import { describe, expect, it } from "vitest";
import {
  applyNativeSpeechEvent,
  beginDictation,
  DICTATION_OFF_PROBLEM,
  dictationFinal,
  dictationPartial,
  isPartialRevision,
  renderDictation,
  describeSpeechError,
  PendingSpeechEvents,
  describeNativeStartError,
  WEB_SPEECH_PROBE_MS,
  webSpeechFailed,
} from "./speech";

describe("webSpeechFailed", () => {
  it("treats an immediate silent end as a failure so the next engine is tried", () => {
    expect(
      webSpeechFailed({ startedAt: 0, endedAt: 120, gotResult: false }),
    ).toBe(true);
  });

  it("fails on real errors but not on a user abort", () => {
    expect(
      webSpeechFailed({
        startedAt: 0,
        endedAt: 5000,
        gotResult: false,
        error: "not-allowed",
      }),
    ).toBe(true);
    expect(
      webSpeechFailed({
        startedAt: 0,
        endedAt: 5000,
        gotResult: false,
        error: "aborted",
      }),
    ).toBe(false);
  });

  it("accepts sessions that heard something or ran past the probe window", () => {
    expect(
      webSpeechFailed({ startedAt: 0, endedAt: 100, gotResult: true }),
    ).toBe(false);
    expect(
      webSpeechFailed({
        startedAt: 0,
        endedAt: WEB_SPEECH_PROBE_MS + 1,
        gotResult: false,
      }),
    ).toBe(false);
  });
});

describe("applyNativeSpeechEvent", () => {
  it("shows partial text live and commits the final transcript", () => {
    expect(
      applyNativeSpeechEvent(7, { session: 7, kind: "partial", text: "hello" }),
    ).toEqual({ interim: "hello" });
    expect(
      applyNativeSpeechEvent(7, {
        session: 7,
        kind: "final",
        text: "hello world",
      }),
    ).toEqual({ interim: "", commit: "hello world" });
    expect(applyNativeSpeechEvent(7, { session: 7, kind: "end" })).toEqual({
      interim: "",
      ended: true,
    });
  });

  it("keeps the last partial when a stopped session ends with an empty final", () => {
    const heard = "check the spark job";
    expect(
      applyNativeSpeechEvent(7, { session: 7, kind: "final", text: "" }, heard),
    ).toEqual({ interim: "", commit: heard });
    expect(
      applyNativeSpeechEvent(7, { session: 7, kind: "final" }, "  "),
    ).toEqual({ interim: "" });
    expect(
      applyNativeSpeechEvent(7, { session: 7, kind: "end" }, heard),
    ).toEqual({ interim: "", commit: heard, ended: true });
    expect(
      applyNativeSpeechEvent(
        7,
        { session: 7, kind: "final", text: "exact words" },
        heard,
      ),
    ).toEqual({ interim: "", commit: "exact words" });
  });

  it("reports errors and ignores other sessions", () => {
    expect(
      applyNativeSpeechEvent(7, { session: 7, kind: "error", error: "boom" }),
    ).toEqual({
      interim: "",
      problem: { message: "Voice input stopped: boom" },
    });
    expect(
      applyNativeSpeechEvent(7, { session: 8, kind: "partial", text: "x" }),
    ).toBeNull();
    expect(
      applyNativeSpeechEvent(null, { session: 7, kind: "final", text: "x" }),
    ).toBeNull();
  });
});

describe("describeNativeStartError", () => {
  it("explains denied permissions and offers the right settings pane", () => {
    const mic = describeNativeStartError("permission:microphone:denied");
    expect(mic?.settings).toBe("microphone");
    expect(mic?.message).toMatch(/Privacy & Security → Microphone/u);
    const speech = describeNativeStartError("permission:speech:denied");
    expect(speech?.settings).toBe("speech");
  });

  it("says restricted access can't be fixed here", () => {
    const p = describeNativeStartError("permission:speech:restricted");
    expect(p?.settings).toBeUndefined();
    expect(p?.message).toMatch(/restricted/u);
  });

  it("returns null when the native engine is simply missing", () => {
    expect(describeNativeStartError("unsupported")).toBeNull();
    expect(
      describeNativeStartError("SFSpeechRecognizer is not available"),
    ).toBeNull();
  });

  it("passes other failures through as a message", () => {
    expect(
      describeNativeStartError("no microphone input is available")?.message,
    ).toMatch(/no microphone input/u);
  });
});

describe("dictation turned off", () => {
  it("maps the recogniser's Siri and Dictation errors to the Keyboard settings card", () => {
    for (const error of [
      "Siri and Dictation are disabled",
      "siri and dictation are disabled",
      "Dictation is disabled",
      "The operation couldn't be completed. (kAFAssistantErrorDomain error 1101.)",
    ]) {
      expect(describeSpeechError(error)).toEqual(DICTATION_OFF_PROBLEM);
      expect(describeNativeStartError(error)).toEqual(DICTATION_OFF_PROBLEM);
    }
    expect(DICTATION_OFF_PROBLEM.settings).toBe("keyboard");
    expect(describeSpeechError("network down")).toEqual({
      message: "Voice input stopped: network down",
    });
  });

  it("reports dictation-off through a native error event", () => {
    expect(
      applyNativeSpeechEvent(3, {
        session: 3,
        kind: "error",
        error: "Siri and Dictation are disabled",
      }),
    ).toEqual({ interim: "", problem: DICTATION_OFF_PROBLEM });
  });
});

describe("PendingSpeechEvents", () => {
  it("replays events that arrived before speech_start returned the session id", () => {
    const pending = new PendingSpeechEvents();
    pending.begin();
    const error = {
      session: 2,
      kind: "error",
      error: "Siri and Dictation are disabled",
    } as const;
    const end = { session: 2, kind: "end" } as const;
    expect(pending.hold(error)).toBe(true);
    expect(pending.hold({ session: 1, kind: "end" })).toBe(true);
    expect(pending.hold(end)).toBe(true);
    const held = pending.release(2);
    expect(held).toEqual([error, end]);
    const updates = held.map((e) => applyNativeSpeechEvent(2, e));
    expect(updates[0]?.problem).toEqual(DICTATION_OFF_PROBLEM);
    expect(updates[1]?.ended).toBe(true);
  });

  it("holds nothing when no start is pending, and drops all on a failed start", () => {
    const pending = new PendingSpeechEvents();
    expect(pending.hold({ session: 1, kind: "end" })).toBe(false);
    pending.begin();
    pending.hold({ session: 1, kind: "end" });
    expect(pending.release(null)).toEqual([]);
    expect(pending.hold({ session: 1, kind: "end" })).toBe(false);
  });
});

describe("continuous dictation", () => {
  it("treats a rewrite of the same words as a revision, a fresh start as a new utterance", () => {
    expect(isPartialRevision("check the", "check the spark job")).toBe(true);
    expect(
      isPartialRevision("check the spark job", "check the Spark job."),
    ).toBe(true);
    expect(
      isPartialRevision("check the spark job", "chick the spark job"),
    ).toBe(true);
    expect(isPartialRevision("check the spark job and its logs", "then")).toBe(
      false,
    );
  });

  it("keeps every utterance across pauses and writes them live", () => {
    let d = beginDictation("", 0);
    d = dictationPartial(d, "check the");
    expect(renderDictation(d).value).toBe("Check the");
    d = dictationPartial(d, "check the spark job");
    expect(renderDictation(d).value).toBe("Check the spark job");
    // A pause: the recogniser finishes the utterance, then starts again empty.
    d = dictationFinal(d, "Check the Spark job.");
    d = dictationPartial(d, "then build");
    expect(renderDictation(d).value).toBe("Check the Spark job. Then build");
    // A new utterance with no final in between still keeps the previous one.
    d = dictationPartial(d, "then build the app");
    d = dictationPartial(d, "and install");
    expect(renderDictation(d).value).toBe(
      "Check the Spark job. Then build the app and install",
    );
  });

  it("an empty final keeps what was heard; empty partials change nothing", () => {
    let d = dictationPartial(beginDictation("", 0), "hello there");
    d = dictationPartial(d, "");
    d = dictationFinal(d, "");
    expect(d.partial).toBe("");
    expect(renderDictation(d).value).toBe("Hello there");
  });

  it("inserts at the caret and keeps the text after it", () => {
    let d = beginDictation("Fix the test. Done", 13);
    d = dictationPartial(d, "then build it");
    const out = renderDictation(d);
    expect(out.value).toBe("Fix the test. Then build it Done");
    expect(out.caret).toBe("Fix the test. Then build it".length);
    d = beginDictation("Fix the test", 12);
    expect(renderDictation(dictationFinal(d, "")).value).toBe("Fix the test");
  });
});
