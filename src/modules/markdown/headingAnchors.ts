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

// Fragment targets can be inline elements, like a footnote reference's
// raised sup anchor (line-height 0 and a -0.5em relative shift in the
// GitHub stylesheet). Aligning that rect to the exact container top clips
// the line that contains it, so the view appears to land below the
// reference. Scrolling the enclosing block instead keeps the whole line
// visible; a heading is its own closest() match, so block targets are
// unaffected.
const BLOCK_ANCHOR = "p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, pre";

// Breathing room above the landing block, so text never sits flush against
// the clipped edge of the scroll container.
const SCROLL_CUSHION = 8;

/**
 * Scrolls the pane's own scroll container (the markdown-body article's
 * parent, the overflow-auto div) so the fragment's target lands at the
 * top. Element.scrollIntoView would scroll EVERY scrollable ancestor,
 * including the pane's overflow-hidden wrapper and the tab stack above it;
 * hidden-overflow boxes ignore the wheel, so the user could never scroll
 * those back and the pane stayed visually sheared with a blank bottom.
 *
 * Ctrl+= zoom is CSS `zoom: var(--app-zoom)` on an ancestor (globals.css
 * .zoom-content, App.tsx <main>), not native webview zoom. Under CSS zoom
 * Chromium splits its geometry: getBoundingClientRect reports VISUAL
 * (zoom-scaled) px, but scrollTop/scrollTo and offsetHeight stay in LAYOUT
 * (unzoomed) px. Feeding a visual rect delta into a layout scrollTop
 * overshot by the zoom factor, so the landing drifted further the more the
 * user zoomed. Divide the visual delta by the scroller's own scale (its
 * visual height over its layout height, both border-box, exactly the zoom,
 * 1 when unzoomed) to convert back to layout scroll units. offsetHeight not
 * clientHeight: a wide table's horizontal scrollbar shrinks clientHeight and
 * would poison the ratio.
 */
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
