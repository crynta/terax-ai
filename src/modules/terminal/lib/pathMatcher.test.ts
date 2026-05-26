import { describe, expect, it } from "vitest";
import { extractPathCandidates } from "./pathMatcher";

describe("extractPathCandidates", () => {
  it("matches a relative compiler path with line and col", () => {
    const out = extractPathCandidates("src/foo.ts:42:5: error TS2322: …");
    expect(out).toEqual([
      { text: "src/foo.ts:42:5", start: 0, end: 15, path: "src/foo.ts", line: 42, col: 5 },
    ]);
  });

  it("matches a relative path with only a line number", () => {
    const out = extractPathCandidates("see ./bar.rs:7 for details");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ path: "./bar.rs", line: 7, col: undefined });
  });

  it("matches an absolute path", () => {
    const out = extractPathCandidates("opened /etc/hosts");
    expect(out).toEqual([
      { text: "/etc/hosts", start: 7, end: 17, path: "/etc/hosts", line: undefined, col: undefined },
    ]);
  });

  it("matches a Windows-style drive path", () => {
    const out = extractPathCandidates("see C:\\Users\\me\\notes.md");
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe("C:\\Users\\me\\notes.md");
  });

  it("matches a bare filename with extension", () => {
    const out = extractPathCandidates("touched README.md and package.json");
    expect(out.map((c) => c.path)).toEqual(["README.md", "package.json"]);
  });

  it("rejects URLs (left to WebLinksAddon)", () => {
    expect(extractPathCandidates("see https://example.com/foo.ts")).toEqual([]);
  });

  it("rejects semver, hex hashes, and bare numbers", () => {
    expect(extractPathCandidates("version 1.2.3 sha abc1234def5 num 12.345")).toEqual([]);
  });

  it("rejects timestamps", () => {
    expect(extractPathCandidates("[2026-05-22T12:34:56] hi")).toEqual([]);
  });

  it("skips lines longer than 1024 chars", () => {
    const big = "a".repeat(1100) + " /etc/hosts";
    expect(extractPathCandidates(big)).toEqual([]);
  });

  it("caps results at 32 per line", () => {
    const tokens = Array.from({ length: 50 }, (_, i) => `f${i}.ts`).join(" ");
    expect(extractPathCandidates(tokens).length).toBeLessThanOrEqual(32);
  });

  it("preserves correct ranges for multiple matches", () => {
    const line = "a.ts and b.ts";
    const out = extractPathCandidates(line);
    expect(out).toEqual([
      { text: "a.ts", start: 0, end: 4, path: "a.ts", line: undefined, col: undefined },
      { text: "b.ts", start: 9, end: 13, path: "b.ts", line: undefined, col: undefined },
    ]);
  });
});
