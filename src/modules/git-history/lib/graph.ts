// Lane-based graph layout for a linear git log.
//
// Input: commits ordered newest-first, each with parent SHAs.
// Output: per-row layout the SVG rail can render directly.
//
// Algorithm: maintain `lanes` — an array of "expected next commits" per lane.
// For each commit top-to-bottom:
//   1. Find lanes that expect this commit (one or more — merges target the
//      leftmost; the others collapse into it).
//   2. If none, allocate the leftmost free slot.
//   3. Replace the commit's lane with its first parent, allocate lanes for
//      additional parents (reusing a lane that already expects them when
//      possible — keeps history visually consistent).
//
// Lane colors are stable per slot index. This keeps the rail readable when
// you load more pages, since lane indices don't shift retroactively.

import type { GitLogEntry } from "@/modules/ai/lib/native";

export type LaneColor = string;

export const LANE_COLORS: LaneColor[] = [
  "#60a5fa", // blue-400
  "#c084fc", // purple-400
  "#34d399", // emerald-400
  "#fbbf24", // amber-400
  "#f472b6", // pink-400
  "#22d3ee", // cyan-400
  "#fb923c", // orange-400
  "#a3e635", // lime-400
];

export function laneColor(index: number): LaneColor {
  return LANE_COLORS[index % LANE_COLORS.length];
}

export type GraphEdge =
  // straight passthrough or first-parent vertical
  | { kind: "straight"; lane: number; color: LaneColor }
  // merge: another lane joins into this commit (top → node)
  | { kind: "merge"; fromLane: number; toLane: number; color: LaneColor }
  // branch: this commit fans out a new lane (node → bottom)
  | { kind: "branch"; fromLane: number; toLane: number; color: LaneColor };

export type GraphRow = {
  sha: string;
  lane: number;
  nodeColor: LaneColor;
  laneCount: number;
  // edges drawn in the *top half* of this row (incoming from row above)
  topEdges: GraphEdge[];
  // edges drawn in the *bottom half* (outgoing to row below)
  bottomEdges: GraphEdge[];
};

export type GraphState = {
  // `lanes[i]` = SHA the next row at lane i is expected to emit (or null).
  lanes: (string | null)[];
};

export const EMPTY_GRAPH_STATE: GraphState = { lanes: [] };

function trimTrailing(lanes: (string | null)[]): (string | null)[] {
  let end = lanes.length;
  while (end > 0 && lanes[end - 1] === null) end--;
  return end === lanes.length ? lanes : lanes.slice(0, end);
}

function firstFreeSlot(lanes: (string | null)[]): number {
  for (let i = 0; i < lanes.length; i++) {
    if (lanes[i] === null) return i;
  }
  return lanes.length;
}

/**
 * Compute graph rows. Pass the previous tail state when appending a new page
 * so lane indices stay stable across pagination.
 */
export function layoutGraph(
  commits: readonly GitLogEntry[],
  previous: GraphState = EMPTY_GRAPH_STATE,
): { rows: GraphRow[]; state: GraphState } {
  const lanes: (string | null)[] = previous.lanes.slice();
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    // Lanes currently expecting this commit.
    const claiming: number[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === commit.sha) claiming.push(i);
    }

    let lane: number;
    if (claiming.length > 0) {
      lane = claiming[0];
    } else {
      lane = firstFreeSlot(lanes);
      if (lane === lanes.length) lanes.push(null);
    }

    const lanesBefore = lanes.slice();
    const topEdges: GraphEdge[] = [];

    // Passthrough lanes (top half): every lane that had a value and is not
    // collapsing into this commit just continues straight down to mid.
    for (let i = 0; i < lanesBefore.length; i++) {
      const v = lanesBefore[i];
      if (v === null) continue;
      if (v === commit.sha && i !== lane) {
        // This lane is merging into the commit at `lane`.
        topEdges.push({
          kind: "merge",
          fromLane: i,
          toLane: lane,
          color: laneColor(i),
        });
      } else if (i === lane && v === commit.sha) {
        // Vertical into node, same lane.
        topEdges.push({ kind: "straight", lane: i, color: laneColor(i) });
      } else {
        // Unrelated lane passing through.
        topEdges.push({ kind: "straight", lane: i, color: laneColor(i) });
      }
    }

    // Special case: no claiming lane — this is a fresh tip. Reserve our lane
    // visually (no incoming top edge for this lane).

    // Collapse all claiming lanes (they're consumed by this row).
    for (const idx of claiming) lanes[idx] = null;
    if (claiming.length === 0) {
      // Reserve the freshly allocated lane temporarily.
      lanes[lane] = null;
    }

    // Place parents.
    const parents = commit.parents;
    const bottomEdges: GraphEdge[] = [];
    if (parents.length > 0) {
      // First parent stays in commit's lane.
      lanes[lane] = parents[0];

      // Additional parents → reuse existing lane or allocate new.
      for (let p = 1; p < parents.length; p++) {
        const parentSha = parents[p];
        let parentLane = lanes.indexOf(parentSha);
        if (parentLane === -1) {
          parentLane = firstFreeSlot(lanes);
          if (parentLane === lanes.length) lanes.push(null);
          lanes[parentLane] = parentSha;
        }
        if (parentLane !== lane) {
          bottomEdges.push({
            kind: "branch",
            fromLane: lane,
            toLane: parentLane,
            color: laneColor(parentLane),
          });
        }
      }
    }

    // Outgoing passthroughs: every active lane in the after-state draws to
    // bottom from its position. Skip the branch lanes we already recorded.
    const branchTargets = new Set(
      bottomEdges
        .filter((e): e is Extract<GraphEdge, { kind: "branch" }> => e.kind === "branch")
        .map((e) => e.toLane),
    );
    for (let i = 0; i < lanes.length; i++) {
      const v = lanes[i];
      if (v === null) continue;
      if (branchTargets.has(i)) continue;
      // First parent extension on commit's own lane, or unrelated passthrough.
      bottomEdges.push({ kind: "straight", lane: i, color: laneColor(i) });
    }

    const trimmed = trimTrailing(lanes);
    if (trimmed.length !== lanes.length) {
      lanes.length = trimmed.length;
    }

    const widestLane = Math.max(
      lanesBefore.length,
      lanes.length,
      lane + 1,
    );

    rows.push({
      sha: commit.sha,
      lane,
      nodeColor: laneColor(lane),
      laneCount: widestLane,
      topEdges,
      bottomEdges,
    });
  }

  return { rows, state: { lanes: lanes.slice() } };
}
