import { describe, expect, it } from "vitest";
import { splitFrontmatter } from "./frontmatter";

type Entries = [string, string][];

describe("splitFrontmatter", () => {
  it("splits a simple mapping into entries and body", () => {
    const { entries, body } = splitFrontmatter(
      "---\n# header comment\nname: my-skill\n\ndescription: Does things\n---\n\n# Title\n",
    );
    expect(entries).toEqual([
      ["name", "my-skill"],
      ["description", "Does things"],
    ]);
    expect(body).toBe("\n# Title\n");
  });

  const scalarCases: [string, string, Entries][] = [
    [
      "colons inside values stay in the value (strict YAML rejects these)",
      'description: Use when asked: "write a PRD", or similar',
      [["description", 'Use when asked: "write a PRD", or similar']],
    ],
    [
      "matching surrounding quotes are stripped",
      "title: \"Hello: world\"\nalt: 'single'",
      [
        ["title", "Hello: world"],
        ["alt", "single"],
      ],
    ],
    ["empty values stay empty", "empty:", [["empty", ""]]],
    [
      "plain scalars stay verbatim strings",
      "count: 3\nenabled: true",
      [
        ["count", "3"],
        ["enabled", "true"],
      ],
    ],
  ];

  it("parses scalar values", () => {
    for (const [, yaml, expected] of scalarCases) {
      const { entries } = splitFrontmatter(`---\n${yaml}\n---\nBody\n`);
      expect(entries).toEqual(expected);
    }
  });

  const blockCases: [string, string, Entries][] = [
    [
      "nested maps render as dedented text",
      "name: x\nmetadata:\n  type: project",
      [
        ["name", "x"],
        ["metadata", "type: project"],
      ],
    ],
    [
      ">- folds newlines into spaces",
      "description: >-\n  First line\n  second line.",
      [["description", "First line second line."]],
    ],
    [
      "| preserves line breaks",
      "notes: |\n  one\n  two",
      [["notes", "one\ntwo"]],
    ],
  ];

  it("parses block collections and scalars", () => {
    for (const [, yaml, expected] of blockCases) {
      const { entries } = splitFrontmatter(`---\n${yaml}\n---\nBody\n`);
      expect(entries).toEqual(expected);
    }
  });

  const fenceCases: [string, string, Entries, string][] = [
    [
      "CRLF line endings",
      "---\r\nname: my-skill\r\n---\r\nBody\r\n",
      [["name", "my-skill"]],
      "Body\r\n",
    ],
    [
      "a leading BOM",
      "\uFEFF---\nname: x\n---\nBody\n",
      [["name", "x"]],
      "Body\n",
    ],
    [
      "a closing fence as the last line of the file",
      "---\nname: x\n---",
      [["name", "x"]],
      "",
    ],
  ];

  it("accepts fence variants", () => {
    for (const [, content, expected, expectedBody] of fenceCases) {
      const { entries, body } = splitFrontmatter(content);
      expect(entries).toEqual(expected);
      expect(body).toBe(expectedBody);
    }
  });

  const rejectionCases: [string, string][] = [
    ["there is no frontmatter", "# Title\n\nBody text.\n"],
    [
      "a later line fails, losing no content",
      "---\nname: ok\ndesc: text\n  illegal continuation\n---\nBody\n",
    ],
    [
      "the first line is not a key: value pair",
      "---\n{ not: valid: yaml\n---\nBody\n",
    ],
    [
      "the fence is not on the very first line",
      "intro\n---\nname: x\n---\nBody\n",
    ],
  ];

  it("leaves non-mappings and misplaced blocks in the body", () => {
    for (const [, content] of rejectionCases) {
      expect(splitFrontmatter(content)).toEqual({ entries: [], body: content });
    }
  });
});
