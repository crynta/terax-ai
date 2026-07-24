/**
 * Heading anchors: h1-h6 get GitHub-style slug ids so a README's TOC links
 * ([Section](#section)) jump within the preview. Slug rules match GitHub:
 * lowercase text content (code spans included), punctuation stripped except
 * hyphens and underscores, spaces to hyphens, duplicate slugs suffixed -1,
 * -2 per document.
 *
 * Runs before rehype-sanitize on purpose: the sanitizer's default schema
 * clobbers every id to user-content-<slug>, which is exactly the form
 * GitHub serves, and resolveFragment looks the prefixed form up first.
 */
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

// ponytail: ASCII-first take on GitHub's slugger. \p{L}\p{N} keeps plain
// unicode letters the way GitHub does, but exotic cases (decomposed
// combining marks, emoji ZWJ sequences) can differ from GitHub's full
// regex; extend only if a real document hits one.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\- ]/gu, "")
    .replace(/ /g, "-");
}

/**
 * Resolves an in-page fragment within the clicking link's own preview pane.
 * Multiple panes stay mounted at once (hidden ones are merely invisible),
 * so heading ids duplicate across panes and a global getElementById could
 * hit the wrong document; closest(".markdown-body") scopes the lookup.
 * The sanitizer's clobbered form wins over the bare fragment, matching
 * GitHub. JSON.stringify yields a valid quoted CSS string, so no CSS.escape
 * (which the node test environment lacks).
 */
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

/**
 * Scrolls the pane's own scroll container (the markdown-body article's
 * parent, the overflow-auto div) so the fragment's heading lands at the
 * top. Element.scrollIntoView would scroll EVERY scrollable ancestor,
 * including the pane's overflow-hidden wrapper and the tab stack above it;
 * hidden-overflow boxes ignore the wheel, so the user could never scroll
 * those back and the pane stayed visually sheared with a blank bottom.
 */
export function scrollToFragment(link: Element, fragment: string): void {
  const target = resolveFragment(link, fragment);
  if (!target) return;
  const scroller = link.closest(".markdown-body")?.parentElement;
  if (!scroller) return;
  const top =
    target.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop;
  scroller.scrollTo({ top });
}
