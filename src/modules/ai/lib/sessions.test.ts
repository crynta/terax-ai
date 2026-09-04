import type { UIMessage } from "@ai-sdk/react";
import { describe, expect, it } from "vitest";
import { deriveTitle } from "./sessions";

function message(text: string, role: UIMessage["role"] = "user"): UIMessage {
  return {
    id: "id",
    role,
    parts: [{ type: "text", text }],
  } as UIMessage;
}

describe("deriveTitle", () => {
  it("returns New chat for no messages", () => {
    expect(deriveTitle([])).toBe("New chat");
  });

  it("skips non-user messages", () => {
    expect(deriveTitle([message("assistant reply", "assistant")])).toBe(
      "New chat",
    );
  });

  it("takes the first user text part", () => {
    expect(deriveTitle([message("what is terax")])).toBe("what is terax");
  });

  it("uses the first line only", () => {
    expect(deriveTitle([message("line one\nline two")])).toBe("line one");
  });

  it("trims surrounding whitespace", () => {
    expect(deriveTitle([message("  padded  ")])).toBe("padded");
  });

  it("strips terminal-context, selection and file blocks", () => {
    const text =
      '<terminal-context project="x">code</terminal-context>\nshort title';
    expect(deriveTitle([message(text)])).toBe("short title");
  });

  it("strips multiple consecutive blocks", () => {
    const text = "<selection>a</selection><file>b</file>\ntitle";
    expect(deriveTitle([message(text)])).toBe("title");
  });

  it("falls back to New chat when only blocks are present", () => {
    const text = "<file>path</file>\n";
    expect(deriveTitle([message(text)])).toBe("New chat");
  });

  it("truncates titles longer than 40 chars with an ellipsis", () => {
    const long = "a".repeat(45);
    expect(deriveTitle([message(long)])).toBe(`${"a".repeat(40)}…`);
  });

  it("keeps a title of exactly 40 chars intact", () => {
    const exactly40 = "a".repeat(40);
    expect(deriveTitle([message(exactly40)])).toBe(exactly40);
  });

  it("walks past an assistant reply to the later user question", () => {
    expect(
      deriveTitle([
        message("assistant reply", "assistant"),
        message("the real question"),
      ]),
    ).toBe("the real question");
  });

  it("skips non-text parts before the first text part", () => {
    const m: UIMessage = {
      id: "id",
      role: "user",
      parts: [
        { type: "file" as const, url: "file:///a.png", mediaType: "image/png" },
        { type: "text", text: "after the attachment" },
      ],
    } as unknown as UIMessage;
    expect(deriveTitle([m])).toBe("after the attachment");
  });

  it("selects the first of several user messages with multiple parts", () => {
    const second: UIMessage = {
      id: "m2",
      role: "user",
      parts: [
        { type: "file" as const, url: "file:///b.txt", mediaType: "text/plain" },
        { type: "text", text: "second question" },
      ],
    } as unknown as UIMessage;
    expect(
      deriveTitle([message("first question"), second]),
    ).toBe("first question");
  });
});
