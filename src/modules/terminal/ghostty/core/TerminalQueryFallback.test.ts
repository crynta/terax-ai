import { describe, expect, it } from "vitest";
import { TerminalQueryFallback } from "./TerminalQueryFallback";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("TerminalQueryFallback", () => {
  it("answers primary and secondary device attribute queries", () => {
    const fallback = new TerminalQueryFallback();
    const replies = fallback.scan(
      encoder.encode("\x1b[c\x1b[0c\x1b[>c\x1b[>0c"),
    );

    expect(replies.map((reply) => decoder.decode(reply.bytes))).toEqual([
      "\x1b[?62;22c",
      "\x1b[?62;22c",
      "\x1b[>1;10;0c",
      "\x1b[>1;10;0c",
    ]);
    expect(replies.map((reply) => reply.endOffset)).toEqual([3, 7, 11, 16]);
  });

  it("tracks a query split across arbitrary PTY chunks", () => {
    const fallback = new TerminalQueryFallback();

    expect(fallback.scan(encoder.encode("before\x1b"))).toEqual([]);
    expect(fallback.scan(encoder.encode("[>"))).toEqual([]);
    const [reply] = fallback.scan(encoder.encode("cafter"));

    expect(reply.endOffset).toBe(1);
    expect(decoder.decode(reply.bytes)).toBe("\x1b[>1;10;0c");
  });

  it("ignores responses, DA3, and query-like bytes in control strings", () => {
    const fallback = new TerminalQueryFallback();
    const bytes = encoder.encode(
      "\x1b[?62;22c\x1b[=c\x1b]0;title \x1b[c\x07\x1bPpayload \x1b[>c\x1b\\",
    );

    expect(fallback.scan(bytes)).toEqual([]);
    expect(
      fallback
        .scan(encoder.encode("\x1b[c"))
        .map((reply) => decoder.decode(reply.bytes)),
    ).toEqual(["\x1b[?62;22c"]);
  });

  it("supports raw 8-bit CSI without mistaking UTF-8 continuation bytes", () => {
    const fallback = new TerminalQueryFallback();

    expect(fallback.scan(new Uint8Array([0xc2, 0x9b, 0x63]))).toEqual([]);
    const [reply] = fallback.scan(new Uint8Array([0x9b, 0x63]));

    expect(decoder.decode(reply.bytes)).toBe("\x1b[?62;22c");
  });
});
