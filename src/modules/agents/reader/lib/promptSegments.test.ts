import { describe, expect, it } from "vitest";
import {
  clampSegments,
  looksPreformatted,
  promptMarkdown,
  promptSegments,
} from "./promptSegments";

const DIAGRAM = [
  " producer / consumer (in-cluster only, PLAINTEXT, nothing connected yet)",
  "        │ 9124 client port",
  "        ▼",
  " ┌─────────────────┐  metadata, leader election  ┌────────────────────┐",
  " │ coordinator ×2  │ ──────────────────────────► │ ZooKeeper ×3        │",
  " └───────┬─────────┘                             └────────────────────┘",
].join("\n");

describe("promptSegments", () => {
  it("keeps a box diagram on its grid, every space intact", () => {
    const segments = promptSegments(`check this bug\n\n${DIAGRAM}\n\nthings are not neat`);
    expect(segments).toEqual([
      { kind: "text", text: "check this bug" },
      { kind: "pre", text: DIAGRAM },
      { kind: "text", text: "things are not neat" },
    ]);
  });

  it("shows a fenced block as pre-formatted, without the fences", () => {
    expect(promptSegments("run\n```\na  b\n  c\n```\ndone")).toEqual([
      { kind: "text", text: "run" },
      { kind: "pre", text: "a  b\n  c" },
      { kind: "text", text: "done" },
    ]);
  });

  it("marks pasted text, pre-formatted only when it needs a grid", () => {
    const prompt = `look\n\n${DIAGRAM}\n\nand\n\nplain words pasted`;
    expect(promptSegments(prompt, [DIAGRAM, "plain words pasted"])).toEqual([
      { kind: "text", text: "look" },
      { kind: "paste", text: DIAGRAM, pre: true },
      { kind: "text", text: "and" },
      { kind: "paste", text: "plain words pasted", pre: false },
    ]);
  });

  it("treats aligned columns as pre-formatted, single spacing as prose", () => {
    expect(looksPreformatted("name   size\nfoo    12")).toBe(true);
    expect(looksPreformatted("one sentence.  Two spaces once.")).toBe(false);
  });
});

describe("clampSegments", () => {
  it("cuts text mid-way but a diagram only at line ends, keeping 12 lines", () => {
    const tall = Array.from({ length: 40 }, (_, i) => `│ row ${i}`).join("\n");
    const { shown, clipped } = clampSegments(
      [{ kind: "text", text: "x".repeat(50) }, { kind: "pre", text: tall }],
      60,
    );
    expect(clipped).toBe(true);
    expect(shown[1].text.split("\n")).toHaveLength(12);
    expect(clampSegments([{ kind: "text", text: "short" }], 60).clipped).toBe(false);
  });
});

describe("promptMarkdown", () => {
  it("fences a diagram so a Markdown copy keeps it aligned", () => {
    expect(promptMarkdown(`why\n\n${DIAGRAM}`)).toBe(
      `why\n\n\`\`\`text\n${DIAGRAM}\n\`\`\``,
    );
  });
});
