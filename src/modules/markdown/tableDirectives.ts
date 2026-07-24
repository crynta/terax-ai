// An HTML comment directly above a table, e.g.
// <!-- table width="100%" cols="12%, auto, 25%" --> ("equal" divides
// evenly), sets width and column sizing; GitHub ignores it. Runs after
// rehype-raw and before rehype-sanitize, which strips the comment and vets
// the injected markup.

const DIRECTIVE = /^\s*table\s+(\S[\s\S]*)$/;
const ATTR = /(\w+)=(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g;

// Minimal structural view of hast nodes, shared by this module's plugins;
// avoids depending on the transitive @types/hast package.
export type HNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
};

export function rehypeTableDirectives() {
  return (tree: unknown) => {
    visit(tree as HNode);
  };
}

function visit(node: HNode): void {
  const kids = node.children;
  if (!kids) return;
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i];
    if (child.type === "comment" && typeof child.value === "string") {
      const m = DIRECTIVE.exec(child.value);
      if (m) applyToNextTable(kids, i + 1, m[1]);
    }
    visit(child);
  }
}

function applyToNextTable(
  siblings: HNode[],
  from: number,
  rawAttrs: string,
): void {
  const attrs = new Map<string, string>();
  for (const m of rawAttrs.matchAll(ATTR)) {
    attrs.set(m[1], m[2] ?? m[3] ?? m[4] ?? "");
  }
  const cols = attrs.get("cols");
  const width = attrs.get("width");
  if (!width && !cols) return;

  const table = nextElement(siblings, from);
  if (table?.tagName !== "table") return;

  if (width) table.properties = { ...table.properties, width };
  if (!cols) return;

  const count = countColumns(table);
  const widths =
    cols === "equal"
      ? equalWidths(count)
      : cols
          .split(",")
          .map((s) => s.trim())
          .slice(0, count > 0 ? count : undefined);
  if (widths.length === 0) return;

  const colgroup: HNode = {
    type: "element",
    tagName: "colgroup",
    properties: {},
    children: widths.map((w) => ({
      type: "element",
      tagName: "col",
      properties: w && w !== "auto" ? { width: w } : {},
      children: [],
    })),
  };
  table.children = [colgroup, ...(table.children ?? [])];
}

function equalWidths(count: number): string[] {
  if (count === 0) return [];
  const pct = Math.round(100000 / count) / 1000;
  return Array<string>(count).fill(`${pct}%`);
}

function nextElement(siblings: HNode[], from: number): HNode | null {
  for (let i = from; i < siblings.length; i++) {
    const n = siblings[i];
    if (n.type === "element") return n;
    if (n.type === "comment") continue;
    if (n.type === "text" && (n.value ?? "").trim() === "") continue;
    return null;
  }
  return null;
}

function countColumns(table: HNode): number {
  const tr = findFirst(table, "tr");
  if (!tr?.children) return 0;
  return tr.children.filter(
    (c) => c.type === "element" && (c.tagName === "th" || c.tagName === "td"),
  ).length;
}

function findFirst(node: HNode, tag: string): HNode | null {
  for (const c of node.children ?? []) {
    if (c.type !== "element") continue;
    if (c.tagName === tag) return c;
    const found = findFirst(c, tag);
    if (found) return found;
  }
  return null;
}
