import { describe, expect, it } from "vitest";
import type { GitBlameLine } from "@/modules/ai/lib/native";
import { blameLabel, relativeTime } from "./blame";

const NOW = 1_700_000_000_000;

function line(over: Partial<GitBlameLine> = {}): GitBlameLine {
  return {
    sha: "a".repeat(40),
    shortSha: "aaaaaaa",
    author: "Ada",
    timestampSecs: NOW / 1000 - 7200,
    summary: "fix parser",
    uncommitted: false,
    ...over,
  };
}

describe("relativeTime", () => {
  it("buckets by magnitude", () => {
    expect(relativeTime(NOW / 1000 - 10, NOW)).toBe("just now");
    expect(relativeTime(NOW / 1000 - 300, NOW)).toBe("5m ago");
    expect(relativeTime(NOW / 1000 - 7200, NOW)).toBe("2h ago");
    expect(relativeTime(NOW / 1000 - 3 * 86400, NOW)).toBe("3d ago");
    expect(relativeTime(NOW / 1000 - 400 * 86400, NOW)).toBe("1y ago");
  });

  it("returns empty for missing timestamps and never goes negative", () => {
    expect(relativeTime(0, NOW)).toBe("");
    expect(relativeTime(NOW / 1000 + 500, NOW)).toBe("just now");
  });
});

describe("blameLabel", () => {
  it("labels committed lines with author, age and summary", () => {
    expect(blameLabel(line(), NOW)).toBe("Ada, 2h ago · fix parser");
  });

  it("labels uncommitted lines", () => {
    expect(blameLabel(line({ uncommitted: true }), NOW)).toBe(
      "You · uncommitted changes",
    );
  });

  it("falls back when the author is missing", () => {
    expect(blameLabel(line({ author: "", summary: "" }), NOW)).toBe(
      "Unknown, 2h ago",
    );
  });
});
