import { describe, expect, it } from "vitest";
import {
  promoteBoldHeadings,
  proseStructure,
  proseWordCount,
  pseudoHeadingAt,
  readTimeLabel,
  splitSections,
} from "./proseStructure";

describe("pseudoHeadingAt", () => {
  it("detects a paragraph that is only bold text", () => {
    const lines = [
      "Intro.",
      "",
      "**Level 1: TabletServer local disk (the hot tier)**",
      "",
      "Body",
    ];
    expect(pseudoHeadingAt(lines, 2)).toBe(
      "Level 1: TabletServer local disk (the hot tier)",
    );
  });

  it("accepts a trailing colon, __bold__, and a list right after", () => {
    expect(pseudoHeadingAt(["**What a reader sees:**", "- one"], 0)).toBe(
      "What a reader sees",
    );
    expect(pseudoHeadingAt(["__Next steps__"], 0)).toBe("Next steps");
  });

  it("ignores bold inside a sentence, list items and mid-paragraph lines", () => {
    expect(pseudoHeadingAt(["**Note:** this is a sentence."], 0)).toBeNull();
    expect(pseudoHeadingAt(["- **item**"], 0)).toBeNull();
    expect(pseudoHeadingAt(["text above", "**Bold**"], 1)).toBeNull();
    expect(pseudoHeadingAt(["**Bold**", "text continues"], 0)).toBeNull();
    expect(pseudoHeadingAt(["**a** and **b**"], 0)).toBeNull();
    expect(pseudoHeadingAt(["** spaced **"], 0)).toBeNull();
  });
});

describe("promoteBoldHeadings", () => {
  it("keeps the words and only changes the markup", () => {
    const md = "Hi.\n\n**What a reader sees**\n- one\n- two\n\n**Done:**\n\nok";
    const out = promoteBoldHeadings(md);
    expect(out).toBe(
      "Hi.\n\n### What a reader sees\n\n- one\n- two\n\n### Done\n\nok",
    );
  });

  it("never touches fenced code", () => {
    const md = "```md\n\n**not a heading**\n\n```\n\n**Real**";
    expect(promoteBoldHeadings(md)).toBe(
      "```md\n\n**not a heading**\n\n```\n\n### Real",
    );
  });
});

describe("splitSections", () => {
  it("splits a reply with two or more headings into sections", () => {
    const md = "Lead in.\n\n## One\nA\n\n### Two\nB\n```\n## not\n```";
    expect(splitSections(md)).toEqual({
      preamble: "Lead in.",
      sections: [
        { heading: "One", body: "A" },
        { heading: "Two", body: "B\n```\n## not\n```" },
      ],
    });
  });

  it("keeps a reply with one heading whole", () => {
    const md = "## Only\nText";
    expect(splitSections(md)).toEqual({ preamble: md, sections: [] });
  });

  it("groups promoted pseudo-headings into sections", () => {
    const md = "**First**\n\na\n\n**Second**\n\nb";
    expect(proseStructure(md).sections.map((s) => s.heading)).toEqual([
      "First",
      "Second",
    ]);
  });
});

describe("read time", () => {
  it("counts words outside code and labels long replies only", () => {
    expect(proseWordCount("one two\n```\nthree four\n```\nfive")).toBe(3);
    expect(readTimeLabel("short reply")).toBeNull();
    expect(
      readTimeLabel(Array.from({ length: 700 }, () => "word").join(" ")),
    ).toBe("3 min read");
  });
});
