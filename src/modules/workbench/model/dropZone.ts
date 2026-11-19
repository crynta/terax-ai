export type DropZone = "stack" | "left" | "right" | "top" | "bottom";

/** Share of a card's width or height, from each edge, that splits on drop. */
const EDGE_ZONE = 0.25;

/**
 * The zone of a card body under a point given in fractions of the body:
 * near an edge splits toward it (the nearest edge wins), the middle stacks.
 */
export function dropZoneAt(fx: number, fy: number): DropZone {
  const distances: [DropZone, number][] = [
    ["left", fx],
    ["right", 1 - fx],
    ["top", fy],
    ["bottom", 1 - fy],
  ];
  const [zone, distance] = distances.reduce((best, next) =>
    next[1] < best[1] ? next : best,
  );
  return distance < EDGE_ZONE ? zone : "stack";
}

/** The split a drop on an edge zone creates. */
export function zoneSplit(zone: Exclude<DropZone, "stack">): {
  dir: "row" | "col";
  side: "before" | "after";
} {
  return {
    dir: zone === "left" || zone === "right" ? "row" : "col",
    side: zone === "left" || zone === "top" ? "before" : "after",
  };
}
