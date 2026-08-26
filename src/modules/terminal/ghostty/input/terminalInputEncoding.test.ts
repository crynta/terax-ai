import { describe, expect, it } from "vitest";
import {
  encodeTerminalPaste,
  encodeTerminalSubmission,
  normalizeTerminalPaste,
} from "./terminalInputEncoding";

describe("terminal input encoding", () => {
  it("normalizes every line ending to terminal carriage returns", () => {
    expect(normalizeTerminalPaste("a\r\nb\nc\rd")).toBe("a\rb\rc\rd");
  });

  it("only brackets multiline submissions when the mode is enabled", () => {
    expect(encodeTerminalSubmission("one\ntwo", false)).toBe("one\rtwo\r");
    expect(encodeTerminalSubmission("one\ntwo", true)).toBe(
      "\x1b[200~one\rtwo\x1b[201~\r",
    );
    expect(encodeTerminalSubmission("one", true)).toBe("one\r");
  });

  it("neutralizes escape bytes inside bracketed paste payloads", () => {
    expect(encodeTerminalPaste("a\x1b[201~b", true)).toBe(
      "\x1b[200~a␛[201~b\x1b[201~",
    );
  });
});
