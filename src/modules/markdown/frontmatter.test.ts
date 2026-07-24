import { describe, expect, it } from "vitest";
import { splitFrontmatter } from "./frontmatter";

describe("splitFrontmatter", () => {
  it("returns content untouched when there is no frontmatter", () => {
    const content = "# Title\n\nBody text.\n";
    expect(splitFrontmatter(content)).toEqual({ entries: [], body: content });
  });

  it("splits a simple mapping into entries and body", () => {
    const { entries, body } = splitFrontmatter(
      "---\nname: my-skill\ndescription: Does things\n---\n\n# Title\n",
    );
    expect(entries).toEqual([
      ["name", "my-skill"],
      ["description", "Does things"],
    ]);
    expect(body).toBe("\n# Title\n");
  });

  it("handles CRLF line endings", () => {
    const { entries, body } = splitFrontmatter(
      "---\r\nname: my-skill\r\n---\r\nBody\r\n",
    );
    expect(entries).toEqual([["name", "my-skill"]]);
    expect(body).toBe("Body\r\n");
  });

  it("rejects the whole block when a later line fails, losing no content", () => {
    const content =
      "---\nname: ok\ndesc: text\n  illegal continuation\n---\nBody\n";
    expect(splitFrontmatter(content)).toEqual({ entries: [], body: content });
  });

  it("tolerates a leading BOM", () => {
    const { entries, body } = splitFrontmatter(
      "\uFEFF---\nname: x\n---\nBody\n",
    );
    expect(entries).toEqual([["name", "x"]]);
    expect(body).toBe("Body\n");
  });

  it("accepts colons inside values (strict YAML rejects these)", () => {
    const { entries } = splitFrontmatter(
      '---\ndescription: Use when asked: "write a PRD", or similar\n---\nBody\n',
    );
    expect(entries).toEqual([
      ["description", 'Use when asked: "write a PRD", or similar'],
    ]);
  });

  it("strips matching surrounding quotes", () => {
    const { entries } = splitFrontmatter(
      "---\ntitle: \"Hello: world\"\nalt: 'single'\n---\nBody\n",
    );
    expect(entries).toEqual([
      ["title", "Hello: world"],
      ["alt", "single"],
    ]);
  });

  it("renders nested blocks as dedented text", () => {
    const { entries } = splitFrontmatter(
      "---\nname: x\nmetadata:\n  type: project\n---\nBody\n",
    );
    expect(entries).toEqual([
      ["name", "x"],
      ["metadata", "type: project"],
    ]);
  });

  it("renders list values as dedented text", () => {
    const { entries } = splitFrontmatter(
      "---\ntags:\n  - alpha\n  - beta\n---\nBody\n",
    );
    expect(entries).toEqual([["tags", "- alpha\n- beta"]]);
  });

  it("folds >- block scalars into a single line", () => {
    const { entries } = splitFrontmatter(
      "---\ndescription: >-\n  First line\n  second line.\n---\nBody\n",
    );
    expect(entries).toEqual([["description", "First line second line."]]);
  });

  it("preserves line breaks in | block scalars", () => {
    const { entries } = splitFrontmatter(
      "---\nnotes: |\n  one\n  two\n---\nBody\n",
    );
    expect(entries).toEqual([["notes", "one\ntwo"]]);
  });

  it("keeps empty values empty and plain scalars verbatim", () => {
    const { entries } = splitFrontmatter(
      "---\ncount: 3\nenabled: true\nempty:\n---\nBody\n",
    );
    expect(entries).toEqual([
      ["count", "3"],
      ["enabled", "true"],
      ["empty", ""],
    ]);
  });

  it("skips blank lines and comments between entries", () => {
    const { entries } = splitFrontmatter(
      "---\n# header comment\nname: x\n\ndescription: y\n---\nBody\n",
    );
    expect(entries).toEqual([
      ["name", "x"],
      ["description", "y"],
    ]);
  });

  it("leaves structurally invalid blocks in the body", () => {
    const content = "---\n{ not: valid: yaml\n---\nBody\n";
    expect(splitFrontmatter(content)).toEqual({ entries: [], body: content });
  });

  it("leaves scalar documents in the body (setext heading case)", () => {
    const content = "---\nJust a heading\n---\nBody\n";
    expect(splitFrontmatter(content)).toEqual({ entries: [], body: content });
  });

  it("only recognizes frontmatter on the very first line", () => {
    const content = "intro\n---\nname: x\n---\nBody\n";
    expect(splitFrontmatter(content)).toEqual({ entries: [], body: content });
  });

  it("accepts a closing fence as the last line of the file", () => {
    const { entries, body } = splitFrontmatter("---\nname: x\n---");
    expect(entries).toEqual([["name", "x"]]);
    expect(body).toBe("");
  });
});
