/**
 * Table layout directives: an HTML comment immediately before a table
 * translates into the standard markup markdown-theme.css honors
 * (`<table width>` + `<colgroup>`), so authoring stays a plain pipe table.
 *
 *   <!-- table width="100%" -->              full width, content-sized columns
 *   <!-- table cols="equal" -->              equal columns, natural table width
 *   <!-- table width="100%" cols="equal" --> full width, equal columns
 *   <!-- table cols="12%, auto, 25%" -->     per-column widths
 *
 * width and cols are independent; combine them in one comment or stack
 * comments (later ones win on conflicts). Attribute values take double,
 * single, or no quotes. "100%" is the only width value the preview
 * stylesheet honors. cols entries are positional (the Nth entry sizes the
 * Nth column) and accept percentages ("25%") or bare pixel counts ("160");
 * the HTML width attribute takes nothing else, and its legacy parser
 * silently truncates units like "12ch" to pixels. "equal" expands to
 * (100/N)% per column. Entries beyond the actual column count are dropped;
 * missing ones leave columns auto-sized. Without width="100%" the browser's
 * auto layout treats column widths as hints, so strict sizing needs the
 * full-width form. GitHub ignores HTML comments, so files degrade to a
 * normal table there.
 *
 * Runs after rehype-raw (which materializes comment nodes) and before
 * rehype-sanitize: the sanitizer strips the comment itself and vets the
 * injected markup, so directives cannot bypass it.
 */

const DIRECTIVE = /^\s*table\s+(\S[\s\S]*)$/;
const ATTR = /(\w+)=(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g;

// Minimal structural view of hast nodes; avoids depending on the transitive
// @types/hast package. Shared by the other hand-rolled rehype plugins in
// this module.
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

/* (100/N)% per column: equalizes under fixed layout and, as far as content
 * allows, under auto layout. */
function equalWidths(count: number): string[] {
  if (count === 0) return [];
  const pct = Math.round(100000 / count) / 1000;
  return Array<string>(count).fill(`${pct}%`);
}

/** Next element sibling; skips comments and whitespace-only text. */
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
