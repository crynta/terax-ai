export type SplitDir = "row" | "col";
export type Direction = "left" | "right" | "up" | "down";

export type CardNode = {
  readonly kind: "card";
  readonly id: number;
  readonly tabIds: readonly number[];
  readonly activeTabId: number;
};

export type SplitNode = {
  readonly kind: "split";
  readonly id: number;
  readonly dir: SplitDir;
  readonly children: readonly LayoutNode[];
  /** One weight per child, summing to 1. */
  readonly ratios: readonly number[];
};

export type LayoutNode = CardNode | SplitNode;

/** A rectangle in fractions of the layout root. */
export type Frame = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

/** The boundary between `children[index - 1]` and `children[index]` of a split. */
export type Divider = {
  readonly splitId: number;
  readonly index: number;
  readonly dir: SplitDir;
  /** Frame of the whole split, which a drag along the divider is relative to. */
  readonly split: Frame;
  /** Position of the boundary along the split axis, in root fractions. */
  readonly at: number;
};

export type LayoutFrames = {
  readonly cards: ReadonlyMap<number, Frame>;
  readonly dividers: readonly Divider[];
};

/** Smallest share a resize leaves any child of a split. */
export const MIN_RATIO = 0.08;

const ROOT: Frame = { x: 0, y: 0, w: 1, h: 1 };

export function card(
  id: number,
  tabIds: readonly number[],
  activeTabId = tabIds[0],
): CardNode {
  return { kind: "card", id, tabIds, activeTabId };
}

function evenRatios(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count);
}

export function normalizeRatios(ratios: readonly number[]): number[] {
  const finite = ratios.map((r) => (Number.isFinite(r) && r > 0 ? r : 0));
  const total = finite.reduce((sum, r) => sum + r, 0);
  if (total <= 0) return evenRatios(ratios.length);
  return finite.map((r) => r / total);
}

export function split(
  id: number,
  dir: SplitDir,
  children: readonly LayoutNode[],
  ratios: readonly number[] = evenRatios(children.length),
): SplitNode {
  return {
    kind: "split",
    id,
    dir,
    children,
    ratios:
      ratios.length === children.length
        ? normalizeRatios(ratios)
        : evenRatios(children.length),
  };
}

export function cards(node: LayoutNode): CardNode[] {
  if (node.kind === "card") return [node];
  return node.children.flatMap(cards);
}

export function cardIds(node: LayoutNode): number[] {
  return cards(node).map((c) => c.id);
}

export function tabIdsOf(node: LayoutNode): number[] {
  return cards(node).flatMap((c) => c.tabIds);
}

export function findCard(node: LayoutNode, id: number): CardNode | null {
  if (node.kind === "card") return node.id === id ? node : null;
  for (const child of node.children) {
    const found = findCard(child, id);
    if (found) return found;
  }
  return null;
}

/** Replaces a card by id, sharing every untouched subtree. */
export function updateCard(
  node: LayoutNode,
  id: number,
  update: (card: CardNode) => CardNode,
): LayoutNode {
  if (node.kind === "card") return node.id === id ? update(node) : node;
  let changed = false;
  const children = node.children.map((child) => {
    const next = updateCard(child, id, update);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

/**
 * Places `added` beside the card `targetId`. When the target already sits in a
 * split running in `dir`, the new card joins that split (no nested same-axis
 * splits) and takes half of the target's share; otherwise the target becomes a
 * two-way split.
 */
export function insertCardBeside(
  node: LayoutNode,
  targetId: number,
  added: CardNode,
  dir: SplitDir,
  side: "before" | "after",
  allocSplitId: () => number,
): LayoutNode {
  if (node.kind === "card") {
    if (node.id !== targetId) return node;
    const pair = side === "after" ? [node, added] : [added, node];
    return split(allocSplitId(), dir, pair);
  }
  if (node.dir === dir) {
    const index = node.children.findIndex(
      (child) => child.kind === "card" && child.id === targetId,
    );
    if (index >= 0) {
      const half = node.ratios[index] / 2;
      const at = side === "after" ? index + 1 : index;
      const children = [...node.children];
      children.splice(at, 0, added);
      const ratios = [...node.ratios];
      ratios[index] = half;
      ratios.splice(at, 0, half);
      return { ...node, children, ratios };
    }
  }
  let changed = false;
  const children = node.children.map((child) => {
    const next = insertCardBeside(
      child,
      targetId,
      added,
      dir,
      side,
      allocSplitId,
    );
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

/**
 * Removes a card. Its share goes to the remaining siblings in proportion,
 * single-child splits collapse into their child, and a collapsed split that
 * runs along its parent's axis is merged into the parent. Returns null when
 * nothing is left.
 */
export function removeCard(node: LayoutNode, id: number): LayoutNode | null {
  if (node.kind === "card") return node.id === id ? null : node;
  const children: LayoutNode[] = [];
  const ratios: number[] = [];
  let changed = false;
  node.children.forEach((child, i) => {
    const next = removeCard(child, id);
    if (next !== child) changed = true;
    if (next === null) return;
    if (next.kind === "split" && next.dir === node.dir) {
      next.children.forEach((grandchild, j) => {
        children.push(grandchild);
        ratios.push(node.ratios[i] * next.ratios[j]);
      });
      changed = true;
      return;
    }
    children.push(next);
    ratios.push(node.ratios[i]);
  });
  if (!changed) return node;
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children, ratios: normalizeRatios(ratios) };
}

export function setSplitRatios(
  node: LayoutNode,
  splitId: number,
  ratios: readonly number[],
): LayoutNode {
  if (node.kind === "card") return node;
  if (node.id === splitId) {
    if (ratios.length !== node.children.length) return node;
    const next = normalizeRatios(ratios);
    return next.every((r, i) => r === node.ratios[i])
      ? node
      : { ...node, ratios: next };
  }
  let changed = false;
  const children = node.children.map((child) => {
    const next = setSplitRatios(child, splitId, ratios);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

export function findSplit(node: LayoutNode, id: number): SplitNode | null {
  if (node.kind === "card") return null;
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findSplit(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * Moves the boundary before `children[index]` by `delta` (a fraction of the
 * split), keeping both neighbours at least `MIN_RATIO`.
 */
export function shiftBoundary(
  ratios: readonly number[],
  index: number,
  delta: number,
): number[] {
  if (index <= 0 || index >= ratios.length) return [...ratios];
  const before = ratios[index - 1];
  const after = ratios[index];
  const pair = before + after;
  const min = Math.min(MIN_RATIO, pair / 2);
  const nextBefore = Math.min(Math.max(before + delta, min), pair - min);
  const next = [...ratios];
  next[index - 1] = nextBefore;
  next[index] = pair - nextBefore;
  return next;
}

export function computeFrames(node: LayoutNode): LayoutFrames {
  const cardFrames = new Map<number, Frame>();
  const dividers: Divider[] = [];
  const walk = (n: LayoutNode, frame: Frame) => {
    if (n.kind === "card") {
      cardFrames.set(n.id, frame);
      return;
    }
    const horizontal = n.dir === "row";
    let offset = horizontal ? frame.x : frame.y;
    n.children.forEach((child, i) => {
      const size = (horizontal ? frame.w : frame.h) * n.ratios[i];
      if (i > 0)
        dividers.push({
          splitId: n.id,
          index: i,
          dir: n.dir,
          split: frame,
          at: offset,
        });
      walk(
        child,
        horizontal
          ? { x: offset, y: frame.y, w: size, h: frame.h }
          : { x: frame.x, y: offset, w: frame.w, h: size },
      );
      offset += size;
    });
  };
  walk(node, ROOT);
  return { cards: cardFrames, dividers };
}

const EPSILON = 1e-6;

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

/**
 * The card a focus or swap in `direction` lands on: among cards across the
 * edge in that direction, the one sharing the most of the edge, then the one
 * closest to the source's centre.
 */
export function neighborCard(
  frames: ReadonlyMap<number, Frame>,
  fromId: number,
  direction: Direction,
): number | null {
  const from = frames.get(fromId);
  if (!from) return null;
  let best: { id: number; shared: number; distance: number } | null = null;
  const fromCx = from.x + from.w / 2;
  const fromCy = from.y + from.h / 2;
  for (const [id, f] of frames) {
    if (id === fromId) continue;
    let adjacent = false;
    let shared = 0;
    switch (direction) {
      case "left":
        adjacent = Math.abs(f.x + f.w - from.x) < EPSILON;
        shared = overlap(from.y, from.y + from.h, f.y, f.y + f.h);
        break;
      case "right":
        adjacent = Math.abs(from.x + from.w - f.x) < EPSILON;
        shared = overlap(from.y, from.y + from.h, f.y, f.y + f.h);
        break;
      case "up":
        adjacent = Math.abs(f.y + f.h - from.y) < EPSILON;
        shared = overlap(from.x, from.x + from.w, f.x, f.x + f.w);
        break;
      case "down":
        adjacent = Math.abs(from.y + from.h - f.y) < EPSILON;
        shared = overlap(from.x, from.x + from.w, f.x, f.x + f.w);
        break;
    }
    if (!adjacent || shared <= EPSILON) continue;
    const distance = Math.hypot(f.x + f.w / 2 - fromCx, f.y + f.h / 2 - fromCy);
    if (
      !best ||
      shared > best.shared + EPSILON ||
      (Math.abs(shared - best.shared) <= EPSILON && distance < best.distance)
    ) {
      best = { id, shared, distance };
    }
  }
  return best?.id ?? null;
}

/** Exchanges what two cards hold, leaving the tree shape alone. */
export function swapCardContents(
  node: LayoutNode,
  a: number,
  b: number,
): LayoutNode {
  const first = findCard(node, a);
  const second = findCard(node, b);
  if (!first || !second || a === b) return node;
  const withA = updateCard(node, a, (c) => ({
    ...c,
    tabIds: second.tabIds,
    activeTabId: second.activeTabId,
  }));
  return updateCard(withA, b, (c) => ({
    ...c,
    tabIds: first.tabIds,
    activeTabId: first.activeTabId,
  }));
}

export function cycleCard(
  node: LayoutNode,
  currentId: number,
  delta: 1 | -1,
): number {
  const ids = cardIds(node);
  const index = ids.indexOf(currentId);
  if (index < 0) return ids[0] ?? currentId;
  return ids[(index + delta + ids.length) % ids.length];
}
