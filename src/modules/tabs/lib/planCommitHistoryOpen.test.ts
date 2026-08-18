import { describe, expect, it } from "vitest";
import { planCommitHistoryOpen, type GitHistoryTab, type Tab } from "./useTabs";

function history(
  id: number,
  repoRoot: string,
  spaceId = "space-a",
): GitHistoryTab {
  return {
    id,
    kind: "git-history",
    spaceId,
    title: "Git History",
    repoRoot,
  };
}

describe("planCommitHistoryOpen", () => {
  it("reuses a repository history tab within the active Space", () => {
    const existing = history(1, "/repos/a");
    let allocations = 0;
    const result = planCommitHistoryOpen(
      [existing],
      { repoRoot: "/repos/a", branch: "main" },
      "space-a",
      () => {
        allocations += 1;
        return 2;
      },
    );

    expect(result.targetId).toBe(1);
    expect(result.tabs[0]).toMatchObject({ title: "History · main" });
    expect(allocations).toBe(0);

    const repeated = planCommitHistoryOpen(
      result.tabs,
      { repoRoot: "/repos/a", branch: "main" },
      "space-a",
      () => 2,
    );
    expect(repeated.tabs).toBe(result.tabs);
  });

  it("opens separate tabs for separate repositories", () => {
    const existing = history(1, "/repos/a");
    const result = planCommitHistoryOpen(
      [existing],
      { repoRoot: "/repos/b", branch: "feature" },
      "space-a",
      () => 2,
    );

    expect(result.targetId).toBe(2);
    expect(result.tabs).toEqual([
      existing,
      expect.objectContaining({
        id: 2,
        repoRoot: "/repos/b",
        spaceId: "space-a",
        title: "History · feature",
      }),
    ]);
  });

  it("does not activate a matching repository tab from another Space", () => {
    const otherSpace = history(1, "/repos/shared", "space-b");
    const tabs: Tab[] = [otherSpace];
    const result = planCommitHistoryOpen(
      tabs,
      { repoRoot: "/repos/shared" },
      "space-a",
      () => 2,
    );

    expect(result.targetId).toBe(2);
    expect(result.tabs).toEqual([
      otherSpace,
      expect.objectContaining({
        id: 2,
        repoRoot: "/repos/shared",
        spaceId: "space-a",
      }),
    ]);
  });
});
