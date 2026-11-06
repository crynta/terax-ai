import { describe, expect, it } from "vitest";
import {
  encodeTerminalPaste,
  encodeTerminalSubmission,
  enqueueTerminalInput,
  normalizeTerminalPaste,
} from "./terminalInputEncoding";

describe("terminal input encoding", () => {
  it.each(["read -r value\r", "\n", "\x1b[13u", "\x1b[13;5u", "\x1b[27;5;13~"])(
    "revokes prompt readiness on accepted submission %j",
    (text) => {
      const session = { commandTracked: true, writer: { enqueue: () => true } };
      expect(
        enqueueTerminalInput(session, new TextEncoder().encode(text)),
      ).toBe(true);
      expect(session.commandTracked).toBe(false);
    },
  );

  it("preserves readiness for typing and rejected submissions", () => {
    const session = { commandTracked: true, writer: { enqueue: () => true } };
    enqueueTerminalInput(session, new TextEncoder().encode("read"));
    expect(session.commandTracked).toBe(true);
    session.writer.enqueue = () => false;
    expect(enqueueTerminalInput(session, new TextEncoder().encode("\r"))).toBe(
      false,
    );
    expect(session.commandTracked).toBe(true);
  });

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
  it("applies the same escape protection to single-line command submissions", () => {
    const command = "echo a\x1b[201~b";
    expect(encodeTerminalSubmission(command, true)).toBe(
      `${encodeTerminalPaste(command, true)}\r`,
    );
  });
});
