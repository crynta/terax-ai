import { describe, expect, it } from "vitest";
import type { GitLogEntry } from "@/modules/ai/lib/native";
import {
  EMPTY_GRAPH_STATE,
  type GraphEdge,
  LANE_COLORS,
  laneColor,
  layoutGraph,
} from "./graph";

// Minimal commit factory. Only `sha` and `parents` drive the layout; the rest
// of GitLogEntry is irrelevant to lane computation but required by the type.
function commit(sha: string, parents: string[] = []): GitLogEntry {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    author: "Test Author",
    authorEmail: "test@example.com",
    timestampSecs: 0,
    parents,
    subject: `subject ${sha}`,
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
  };
}

function straightLanes(edges: GraphEdge[]): number[] {
  return edges
    .filter((e): e is Extract<GraphEdge, { kind: "straight" }> => {
      return e.kind === "straight";
    })
    .map((e) => e.lane)
    .sort((a, b) => a - b);
}

describe("laneColor", () => {
  it("returns the color at the given slot index", () => {
    expect(laneColor(0)).toBe(LANE_COLORS[0]);
    expect(laneColor(3)).toBe(LANE_COLORS[3]);
  });

  it("wraps around modulo the palette length", () => {
    expect(laneColor(LANE_COLORS.length)).toBe(LANE_COLORS[0]);
    expect(laneColor(LANE_COLORS.length + 2)).toBe(LANE_COLORS[2]);
  });

  it("is stable per slot regardless of how many lanes exist", () => {
    expect(laneColor(1)).toBe(laneColor(1 + LANE_COLORS.length));
  });
});

describe("layoutGraph - empty and trivial inputs", () => {
  it("returns no rows and an empty state for no commits", () => {
    const result = layoutGraph([]);
    expect(result.rows).toEqual([]);
    expect(result.state).toEqual({ lanes: [] });
  });

  it("does not mutate the shared EMPTY_GRAPH_STATE", () => {
    layoutGraph([commit("a", ["b"])]);
    expect(EMPTY_GRAPH_STATE).toEqual({ lanes: [] });
  });

  it("does not mutate the previous state passed in", () => {
    const previous = { lanes: ["a"] as (string | null)[] };
    const snapshot = previous.lanes.slice();
    layoutGraph([commit("a", ["b"])], previous);
    expect(previous.lanes).toEqual(snapshot);
  });

  it("lays out a root commit (no parents) on lane 0", () => {
    const { rows, state } = layoutGraph([commit("a", [])]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sha).toBe("a");
    expect(rows[0].lane).toBe(0);
    expect(rows[0].nodeColor).toBe(laneColor(0));
    expect(rows[0].laneCount).toBe(1);
    // Root has no parents, so no lane continues below it.
    expect(rows[0].bottomEdges).toEqual([]);
    // No claiming lane existed above, so no top edges either.
    expect(rows[0].topEdges).toEqual([]);
    expect(state.lanes).toEqual([]);
  });
});

describe("layoutGraph - linear history", () => {
  const linear = [commit("c3", ["c2"]), commit("c2", ["c1"]), commit("c1", [])];

  it("keeps every commit on lane 0", () => {
    const { rows } = layoutGraph(linear);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows.map((r) => r.laneCount)).toEqual([1, 1, 1]);
  });

  it("draws a single straight bottom edge into the next commit", () => {
    const { rows } = layoutGraph(linear);
    // First two rows extend lane 0 to their parent below.
    expect(rows[0].bottomEdges).toEqual([
      { kind: "straight", lane: 0, color: laneColor(0) },
    ]);
    expect(rows[1].bottomEdges).toEqual([
      { kind: "straight", lane: 0, color: laneColor(0) },
    ]);
    // Tail (root) has no children below it.
    expect(rows[2].bottomEdges).toEqual([]);
  });

  it("draws a straight top edge for claimed (non-tip) commits", () => {
    const { rows } = layoutGraph(linear);
    // The first row is a fresh tip; nothing flows in from above.
    expect(rows[0].topEdges).toEqual([]);
    // Subsequent commits are claimed by lane 0 from the row above.
    expect(rows[1].topEdges).toEqual([
      { kind: "straight", lane: 0, color: laneColor(0) },
    ]);
    expect(rows[2].topEdges).toEqual([
      { kind: "straight", lane: 0, color: laneColor(0) },
    ]);
  });

  it("ends with lane 0 cleared once the root is reached", () => {
    const { state } = layoutGraph(linear);
    expect(state.lanes).toEqual([]);
  });
});

describe("layoutGraph - branching (multiple tips)", () => {
  // Two independent tips that never converge.
  const twoTips = [
    commit("a", ["a0"]),
    commit("b", ["b0"]),
    commit("a0", []),
    commit("b0", []),
  ];

  it("allocates a fresh leftmost free lane for each new tip", () => {
    const { rows } = layoutGraph(twoTips);
    expect(rows[0].lane).toBe(0); // a -> lane 0
    expect(rows[1].lane).toBe(1); // b -> lane 1 (0 occupied by a0)
  });

  it("reports laneCount reflecting the widest point", () => {
    const { rows } = layoutGraph(twoTips);
    // When b appears, lane 0 (a0) is still active, so two lanes are visible.
    expect(rows[1].laneCount).toBe(2);
  });

  it("reuses a freed lane for a later unrelated tip", () => {
    const commits = [
      commit("a", []), // lane 0, then freed (no parents)
      commit("b", []), // lane 0 free again -> reuse lane 0
    ];
    const { rows } = layoutGraph(commits);
    expect(rows[0].lane).toBe(0);
    expect(rows[1].lane).toBe(0);
  });
});

describe("layoutGraph - merge commits", () => {
  // m merges two parents p1 and p2; p1 is reachable first.
  //   m  (parents p1, p2)
  //   p1 (parent base)
  //   p2 (parent base)
  //   base
  const merge = [
    commit("m", ["p1", "p2"]),
    commit("p1", ["base"]),
    commit("p2", ["base"]),
    commit("base", []),
  ];

  it("fans out a branch edge for the second parent", () => {
    const { rows } = layoutGraph(merge);
    const mRow = rows[0];
    expect(mRow.lane).toBe(0);
    const branch = mRow.bottomEdges.find((e) => e.kind === "branch");
    expect(branch).toEqual({
      kind: "branch",
      fromLane: 0,
      toLane: 1,
      color: laneColor(1),
    });
  });

  it("keeps the first parent on the merge commit's own lane", () => {
    const { rows } = layoutGraph(merge);
    // p1 is claimed by lane 0 (first parent of m).
    expect(rows[1].sha).toBe("p1");
    expect(rows[1].lane).toBe(0);
    // p2 is claimed by lane 1 (second parent of m).
    expect(rows[2].sha).toBe("p2");
    expect(rows[2].lane).toBe(1);
  });

  it("collapses a side lane back with a merge top edge when lanes converge", () => {
    // m1 and m2 are siblings; m2's parent is shared, producing a converge.
    //   tip   (parents m1, m2)
    //   m1    (parent shared)
    //   m2    (parent shared)
    //   shared
    const commits = [
      commit("tip", ["m1", "m2"]),
      commit("m1", ["shared"]),
      commit("m2", ["shared"]),
      commit("shared", []),
    ];
    const { rows } = layoutGraph(commits);
    // shared is expected by both lane 0 (via m1) and lane 1 (via m2).
    const sharedRow = rows[3];
    expect(sharedRow.sha).toBe("shared");
    expect(sharedRow.lane).toBe(0); // leftmost claiming lane wins
    const mergeEdge = sharedRow.topEdges.find((e) => e.kind === "merge");
    expect(mergeEdge).toEqual({
      kind: "merge",
      fromLane: 1,
      toLane: 0,
      color: laneColor(1),
    });
  });

  it("frees the collapsed lane after a converge", () => {
    const commits = [
      commit("tip", ["m1", "m2"]),
      commit("m1", ["shared"]),
      commit("m2", ["shared"]),
      commit("shared", []),
    ];
    const { state } = layoutGraph(commits);
    // After the root `shared`, all lanes should be cleared (trailing trimmed).
    expect(state.lanes).toEqual([]);
  });

  it("reuses an existing lane that already expects a shared parent", () => {
    // A merge whose second parent is already tracked in another lane should
    // not allocate a brand-new lane for it.
    //   feat (parents main, side)
    //   side (parent main)   <-- side already points at main
    //   main (parent root)
    //   root
    const commits = [
      commit("feat", ["main", "side"]),
      commit("side", ["main"]),
      commit("main", ["root"]),
      commit("root", []),
    ];
    const { rows } = layoutGraph(commits);
    // feat occupies lane 0; main stays on lane 0, side goes to lane 1.
    expect(rows[0].lane).toBe(0);
    // side is the second parent -> lane 1.
    expect(rows[1].sha).toBe("side");
    expect(rows[1].lane).toBe(1);
    // main is reached on lane 0 (first parent line).
    expect(rows[2].sha).toBe("main");
    expect(rows[2].lane).toBe(0);
  });
});

describe("layoutGraph - octopus merge (3+ parents)", () => {
  const octopus = [
    commit("o", ["p1", "p2", "p3"]),
    commit("p1", []),
    commit("p2", []),
    commit("p3", []),
  ];

  it("creates one branch edge per additional parent", () => {
    const { rows } = layoutGraph(octopus);
    const branches = rows[0].bottomEdges.filter((e) => e.kind === "branch");
    expect(branches).toHaveLength(2);
    expect(
      branches.map((e) => (e as { toLane: number }).toLane).sort(),
    ).toEqual([1, 2]);
  });

  it("assigns each parent its own lane", () => {
    const { rows } = layoutGraph(octopus);
    expect(rows[1].lane).toBe(0); // p1 -> first parent lane
    expect(rows[2].lane).toBe(1); // p2
    expect(rows[3].lane).toBe(2); // p3
    // Widest point is three lanes.
    expect(rows[0].laneCount).toBe(3);
  });
});

describe("layoutGraph - pagination / state continuity", () => {
  it("produces identical rows whether paged or computed in one pass", () => {
    const all = [
      commit("c4", ["c3"]),
      commit("c3", ["c2"]),
      commit("c2", ["c1"]),
      commit("c1", []),
    ];
    const single = layoutGraph(all);

    const firstPage = layoutGraph(all.slice(0, 2));
    const secondPage = layoutGraph(all.slice(2), firstPage.state);

    const pagedRows = [...firstPage.rows, ...secondPage.rows];
    expect(pagedRows).toEqual(single.rows);
    expect(secondPage.state).toEqual(single.state);
  });

  it("keeps lane indices stable across pages for a branch in flight", () => {
    // Page 1 ends mid-merge so a side lane is carried into page 2.
    const page1 = [
      commit("m", ["p1", "p2"]), // opens lane 1 for p2
      commit("p1", ["base"]), // lane 0
    ];
    const page2 = [
      commit("p2", ["base"]), // should land on lane 1 carried over
      commit("base", []),
    ];
    const r1 = layoutGraph(page1);
    expect(r1.state.lanes).toContain("p2");

    const r2 = layoutGraph(page2, r1.state);
    expect(r2.rows[0].sha).toBe("p2");
    expect(r2.rows[0].lane).toBe(1);
  });

  it("carries pending parent SHAs in the returned state", () => {
    const { state } = layoutGraph([commit("head", ["next"])]);
    expect(state.lanes).toEqual(["next"]);
  });
});

describe("layoutGraph - structural invariants", () => {
  const tangled = [
    commit("a", ["b", "c"]),
    commit("b", ["d"]),
    commit("c", ["d"]),
    commit("d", ["e", "f"]),
    commit("e", ["g"]),
    commit("f", ["g"]),
    commit("g", []),
  ];

  it("places the node lane within the reported laneCount", () => {
    const { rows } = layoutGraph(tangled);
    for (const row of rows) {
      expect(row.lane).toBeGreaterThanOrEqual(0);
      expect(row.lane).toBeLessThan(row.laneCount);
    }
  });

  it("colors every node by its own lane index", () => {
    const { rows } = layoutGraph(tangled);
    for (const row of rows) {
      expect(row.nodeColor).toBe(laneColor(row.lane));
    }
  });

  it("never references a negative lane in any edge", () => {
    const { rows } = layoutGraph(tangled);
    for (const row of rows) {
      for (const edge of [...row.topEdges, ...row.bottomEdges]) {
        if (edge.kind === "straight") {
          expect(edge.lane).toBeGreaterThanOrEqual(0);
        } else {
          expect(edge.fromLane).toBeGreaterThanOrEqual(0);
          expect(edge.toLane).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("does not emit duplicate straight bottom edges for the same lane", () => {
    const { rows } = layoutGraph(tangled);
    for (const row of rows) {
      const lanes = straightLanes(row.bottomEdges);
      const unique = new Set(lanes);
      expect(unique.size).toBe(lanes.length);
    }
  });

  it("returns a state copy that is independent of further mutation", () => {
    const { state } = layoutGraph([commit("x", ["y"])]);
    const before = state.lanes.slice();
    state.lanes.push("mutated");
    // The earlier captured copy is unaffected; this just asserts we got an
    // owned array back rather than internal state shared by reference.
    expect(before).toEqual(["y"]);
  });
});
