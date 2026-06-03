import { describe, expect, it } from "vitest";
import {
  shouldIgnoreEnterAfterImeCommit,
  shouldSubmitOnEnter,
} from "./AiInputBar";

describe("shouldSubmitOnEnter", () => {
  it("submits plain Enter", () => {
    expect(
      shouldSubmitOnEnter({
        key: "Enter",
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(true);
  });

  it("does not submit while composing IME text", () => {
    expect(
      shouldSubmitOnEnter({
        key: "Enter",
        shiftKey: false,
        isComposing: true,
      }),
    ).toBe(false);
  });

  it("does not submit on the IME keyCode 229 fallback", () => {
    expect(
      shouldSubmitOnEnter({
        key: "Enter",
        shiftKey: false,
        isComposing: false,
        keyCode: 229,
      }),
    ).toBe(false);
  });

  it("does not submit Shift+Enter", () => {
    expect(
      shouldSubmitOnEnter({
        key: "Enter",
        shiftKey: true,
        isComposing: false,
      }),
    ).toBe(false);
  });

  it("swallows the first Enter immediately after an IME commit", () => {
    expect(
      shouldIgnoreEnterAfterImeCommit({
        key: "Enter",
        now: 100,
        ignoreUntil: 500,
      }),
    ).toBe(true);
  });

  it("does not swallow a later normal Enter", () => {
    expect(
      shouldIgnoreEnterAfterImeCommit({
        key: "Enter",
        now: 800,
        ignoreUntil: 500,
      }),
    ).toBe(false);
  });
});
