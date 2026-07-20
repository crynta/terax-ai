import { describe, expect, it } from "vitest";
import type { GitLogEntry } from "@/modules/ai/lib/native";
import { LANE_COLORS, laneColor, layoutGraph } from "./graph";

function commit(sha: string, parents: string[]): GitLogEntry {
  return { sha, parents } as unknown as GitLogEntry;
}

describe("laneColor", () => {
  it("cycles through the palette by lane index", () => {
    expect(laneColor(0)).toBe(LANE_COLORS[0]);
    expect(laneColor(1)).toBe(LANE_COLORS[1]);
    expect(laneColor(LANE_COLORS.length)).toBe(LANE_COLORS[0]);
  });
});

describe("layoutGraph", () => {
  it("returns nothing for an empty log", () => {
    const { rows, state } = layoutGraph([]);
    expect(rows).toEqual([]);
    expect(state.lanes).toEqual([]);
  });

  it("keeps a linear history in a single lane", () => {
    const { rows } = layoutGraph([
      commit("c", ["b"]),
      commit("b", ["a"]),
      commit("a", []),
    ]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows.every((r) => r.laneCount === 1)).toBe(true);
  });

  it("colors each node by its lane", () => {
    const { rows } = layoutGraph([
      commit("E", ["D"]),
      commit("D", ["C", "B"]),
      commit("C", ["A"]),
      commit("B", ["A"]),
      commit("A", []),
    ]);
    for (const row of rows) {
      expect(row.nodeColor).toBe(laneColor(row.lane));
    }
  });

  it("assigns a second lane to a diverging branch", () => {
    const { rows } = layoutGraph([
      commit("E", ["D"]),
      commit("D", ["C", "B"]),
      commit("C", ["A"]),
      commit("B", ["A"]),
      commit("A", []),
    ]);
    expect(rows.map((r) => `${r.sha}:${r.lane}`)).toEqual([
      "E:0",
      "D:0",
      "C:0",
      "B:1",
      "A:0",
    ]);
    expect(rows.map((r) => r.laneCount)).toEqual([1, 2, 2, 2, 2]);
  });

  it("emits a branch edge when a merge commit fans out a parent", () => {
    const { rows } = layoutGraph([
      commit("D", ["C", "B"]),
      commit("C", ["A"]),
      commit("B", ["A"]),
      commit("A", []),
    ]);
    const mergeRow = rows.find((r) => r.sha === "D");
    expect(mergeRow?.bottomEdges).toContainEqual(
      expect.objectContaining({ kind: "branch", fromLane: 0, toLane: 1 }),
    );
  });

  it("emits a merge edge when two lanes collapse into one commit", () => {
    const { rows } = layoutGraph([
      commit("D", ["C", "B"]),
      commit("C", ["A"]),
      commit("B", ["A"]),
      commit("A", []),
    ]);
    const rootRow = rows.find((r) => r.sha === "A");
    expect(rootRow?.topEdges).toContainEqual(
      expect.objectContaining({ kind: "merge", toLane: 0 }),
    );
  });

  it("keeps lane indices stable across pagination", () => {
    const log = [
      commit("E", ["D"]),
      commit("D", ["C", "B"]),
      commit("C", ["A"]),
      commit("B", ["A"]),
      commit("A", []),
    ];
    const whole = layoutGraph(log).rows.map((r) => `${r.sha}:${r.lane}`);

    for (let split = 1; split < log.length; split++) {
      const page1 = layoutGraph(log.slice(0, split));
      const page2 = layoutGraph(log.slice(split), page1.state);
      const paged = [...page1.rows, ...page2.rows].map(
        (r) => `${r.sha}:${r.lane}`,
      );
      expect(paged).toEqual(whole);
    }
  });
});
