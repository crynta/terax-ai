import { describe, expect, it } from "vitest";
import {
  buildUserPrompt,
  COMPLETION_SYSTEM_PROMPT,
  type CompletionRequest,
  trimContext,
} from "./prompt";

const MAX_PREFIX = 2000;
const MAX_SUFFIX = 1000;

describe("trimContext", () => {
  it("returns short prefix and suffix untouched", () => {
    const { prefix, suffix } = trimContext("abc", "xyz");
    expect(prefix).toBe("abc");
    expect(suffix).toBe("xyz");
  });

  it("handles empty inputs", () => {
    expect(trimContext("", "")).toEqual({ prefix: "", suffix: "" });
  });

  it("keeps the tail of an oversized prefix (text nearest the cursor)", () => {
    // The cursor sits at the end of the prefix, so the most relevant context
    // is the final MAX_PREFIX characters.
    const prefix = `${"A".repeat(MAX_PREFIX)}TAIL`;
    const { prefix: out } = trimContext(prefix, "");
    expect(out).toHaveLength(MAX_PREFIX);
    expect(out.endsWith("TAIL")).toBe(true);
    expect(out.startsWith("A")).toBe(true);
  });

  it("keeps the head of an oversized suffix (text nearest the cursor)", () => {
    // The cursor sits at the start of the suffix, so keep the first chars.
    const suffix = `HEAD${"B".repeat(MAX_SUFFIX)}`;
    const { suffix: out } = trimContext("", suffix);
    expect(out).toHaveLength(MAX_SUFFIX);
    expect(out.startsWith("HEAD")).toBe(true);
  });

  it("does not trim inputs exactly at the limit (off-by-one boundary)", () => {
    const prefix = "p".repeat(MAX_PREFIX);
    const suffix = "s".repeat(MAX_SUFFIX);
    const out = trimContext(prefix, suffix);
    expect(out.prefix).toBe(prefix);
    expect(out.suffix).toBe(suffix);
  });

  it("trims when one character over the limit", () => {
    const prefix = "p".repeat(MAX_PREFIX + 1);
    const suffix = "s".repeat(MAX_SUFFIX + 1);
    const out = trimContext(prefix, suffix);
    expect(out.prefix).toHaveLength(MAX_PREFIX);
    expect(out.suffix).toHaveLength(MAX_SUFFIX);
  });

  it("trims prefix and suffix independently", () => {
    const prefix = "x".repeat(MAX_PREFIX + 50);
    const suffix = "ok";
    const out = trimContext(prefix, suffix);
    expect(out.prefix).toHaveLength(MAX_PREFIX);
    expect(out.suffix).toBe("ok");
  });
});

function req(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    prefix: "const a = ",
    suffix: ";",
    language: "typescript",
    filename: "main.ts",
    ...overrides,
  };
}

describe("buildUserPrompt", () => {
  it("includes a File line and Language line when both are present", () => {
    const out = buildUserPrompt(req());
    expect(out).toContain("File: main.ts");
    expect(out).toContain("Language: typescript");
    // The meta block precedes the PREFIX section.
    expect(out.indexOf("File: main.ts")).toBeLessThan(out.indexOf("PREFIX:"));
  });

  it("omits the meta block entirely when filename and language are null", () => {
    const out = buildUserPrompt(req({ filename: null, language: null }));
    expect(out).not.toContain("File:");
    expect(out).not.toContain("Language:");
    expect(out.startsWith("PREFIX:")).toBe(true);
  });

  it("includes only the File line when language is null", () => {
    const out = buildUserPrompt(req({ language: null }));
    expect(out).toContain("File: main.ts");
    expect(out).not.toContain("Language:");
  });

  it("includes only the Language line when filename is null", () => {
    const out = buildUserPrompt(req({ filename: null }));
    expect(out).not.toContain("File:");
    expect(out).toContain("Language: typescript");
  });

  it("embeds the prefix and suffix between fence markers", () => {
    const out = buildUserPrompt(
      req({ prefix: "foo(", suffix: ")", filename: null, language: null }),
    );
    expect(out).toContain("PREFIX:\n<<<\nfoo(\n>>>");
    expect(out).toContain("SUFFIX:\n<<<\n)\n>>>");
    expect(
      out.trimEnd().endsWith("Output the text to insert at the cursor."),
    ).toBe(true);
  });

  it("applies trimContext to oversized prefix before embedding", () => {
    const prefix = "Z".repeat(MAX_PREFIX + 500);
    const out = buildUserPrompt(
      req({ prefix, filename: null, language: null }),
    );
    // The full oversized prefix must not survive verbatim.
    expect(out).not.toContain(prefix);
    // The trimmed tail is what should be embedded.
    expect(out).toContain("Z".repeat(MAX_PREFIX));
  });

  it("handles empty prefix and suffix gracefully", () => {
    const out = buildUserPrompt(
      req({ prefix: "", suffix: "", filename: null, language: null }),
    );
    expect(out).toContain("PREFIX:\n<<<\n\n>>>");
    expect(out).toContain("SUFFIX:\n<<<\n\n>>>");
  });
});

describe("COMPLETION_SYSTEM_PROMPT", () => {
  it("is a non-empty fill-in-the-middle instruction", () => {
    expect(typeof COMPLETION_SYSTEM_PROMPT).toBe("string");
    expect(COMPLETION_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    expect(COMPLETION_SYSTEM_PROMPT).toMatch(/fill-in-the-middle/i);
    expect(COMPLETION_SYSTEM_PROMPT).toContain("PREFIX");
    expect(COMPLETION_SYSTEM_PROMPT).toContain("SUFFIX");
  });
});
