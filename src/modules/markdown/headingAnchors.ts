// GitHub-style heading slug ids. Runs before rehype-sanitize, which
// clobbers every id to user-content-<slug>, the form GitHub serves.
import type { HNode } from "./tableDirectives";

const HEADING = /^h[1-6]$/;

export function rehypeHeadingAnchors() {
  return (tree: unknown) => {
    visit(tree as HNode, new Set());
  };
}

function visit(node: HNode, used: Set<string>): void {
  if (node.type === "element" && HEADING.test(node.tagName ?? "")) {
    const base = slugify(textOf(node));
    let id = base;
    for (let n = 1; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    node.properties = { ...node.properties, id };
  }
  for (const child of node.children ?? []) {
    visit(child, used);
  }
}

function textOf(node: HNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

// Simplified GitHub slugger; exotic unicode (combining marks, ZWJ
// sequences) can differ.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\- ]/gu, "")
    .replace(/ /g, "-");
}

// Hidden panes stay mounted and ids duplicate across documents, so scope
// to the link's own pane. JSON.stringify quotes the id (no CSS.escape in
// the node test environment).
export function resolveFragment(
  link: Element,
  fragment: string,
): Element | null {
  const pane = link.closest(".markdown-body");
  if (!pane) return null;
  let id = fragment;
  try {
    id = decodeURIComponent(fragment);
  } catch {
    // Malformed percent escape: fall back to the raw fragment.
  }
  return (
    pane.querySelector(`[id=${JSON.stringify(`user-content-${id}`)}]`) ??
    pane.querySelector(`[id=${JSON.stringify(id)}]`)
  );
}

// Inline fragment targets (a footnote's raised sup anchor) sit above their
// line box; landing on the enclosing block keeps the whole line visible.
const BLOCK_ANCHOR = "p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, pre";

// Breathing room above the landing block.
const SCROLL_CUSHION = 8;

// scrollIntoView would also scroll overflow-hidden ancestors the user
// cannot scroll back. Under CSS zoom rects are visual px but scrollTop is
// layout px: divide by the scroller's visual/layout height ratio
// (offsetHeight, so a horizontal scrollbar cannot skew it).
export function scrollToFragment(link: Element, fragment: string): void {
  const target = resolveFragment(link, fragment);
  if (!target) return;
  const scroller = link.closest(".markdown-body")?.parentElement;
  if (!scroller) return;
  const anchor = target.closest(BLOCK_ANCHOR) ?? target;
  const box = scroller.getBoundingClientRect();
  const layoutHeight = scroller.offsetHeight;
  const scale = layoutHeight > 0 ? box.height / layoutHeight : 1;
  const top =
    scroller.scrollTop +
    (anchor.getBoundingClientRect().top - box.top) / scale -
    SCROLL_CUSHION;
  scroller.scrollTo({ top: Math.max(0, top) });
}
