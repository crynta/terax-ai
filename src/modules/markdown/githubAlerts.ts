/**
 * GFM alerts: a blockquote whose first line is exactly one of [!NOTE],
 * [!TIP], [!IMPORTANT], [!WARNING] or [!CAUTION] becomes the structure the
 * vendored GitHub stylesheet (markdown-base.css) already styles:
 *
 *   <div class="markdown-alert markdown-alert-note">
 *     <p class="markdown-alert-title">Note</p>
 *     ...the blockquote's remaining content, unchanged...
 *   </div>
 *
 * GitHub semantics: the marker is case-insensitive and must sit alone on
 * the blockquote's first line with nothing before it. Content on the marker
 * line, an unknown type, or a marker arriving after other content leaves
 * the blockquote untouched, so the text renders literally like on GitHub.
 *
 * Runs after rehype-raw and before rehype-sanitize, which vets the injected
 * markup and prunes class names to the enumerated allowlist in
 * RenderedMarkdown.tsx. Title icons are CSS mask data URIs in
 * markdown-theme.css, so the sanitizer never admits svg/path elements.
 */
import type { HNode } from "./tableDirectives";

const MARKER = /^\[!(note|tip|important|warning|caution)\][^\S\n]*(?:\n|$)/i;

export function rehypeGithubAlerts() {
  return (tree: unknown) => {
    visit(tree as HNode, false);
  };
}

// ponytail: GitHub-parity ceiling, alerts never nest. A marker blockquote
// inside another blockquote (or inside an alert) stays a plain blockquote.
function visit(node: HNode, insideQuote: boolean): void {
  const quote = node.type === "element" && node.tagName === "blockquote";
  if (quote && !insideQuote) tryTransform(node);
  for (const child of node.children ?? []) {
    visit(child, insideQuote || quote);
  }
}

function tryTransform(quote: HNode): void {
  const kids = quote.children ?? [];
  let p: HNode | undefined;
  let pIndex = -1;
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (k.type === "element") {
      p = k;
      pIndex = i;
      break;
    }
    if (k.type === "text" && (k.value ?? "").trim() !== "") return;
  }
  if (p?.tagName !== "p" || !p.children?.length) return;

  const first = p.children[0];
  if (first.type !== "text" || typeof first.value !== "string") return;
  const m = MARKER.exec(first.value);
  if (!m) return;

  if (m[0].endsWith("\n")) {
    // Marker plus soft break: the rest of the paragraph is alert content.
    first.value = first.value.slice(m[0].length);
    if (first.value === "") p.children.shift();
  } else {
    // Marker is the entire text node. Anything else on that line except a
    // trailing hard break means it is not an alert (GitHub semantics).
    const next = p.children[1];
    if (!next) {
      kids.splice(pIndex, 1);
    } else if (next.type === "element" && next.tagName === "br") {
      p.children.splice(0, 2);
      const lead = p.children[0];
      if (lead?.type === "text" && typeof lead.value === "string") {
        lead.value = lead.value.replace(/^\n/, "");
      }
    } else {
      return;
    }
  }

  const type = m[1].toLowerCase();
  quote.tagName = "div";
  quote.properties = {
    className: ["markdown-alert", `markdown-alert-${type}`],
  };
  quote.children = [
    {
      type: "element",
      tagName: "p",
      properties: { className: ["markdown-alert-title"] },
      children: [
        { type: "text", value: type[0].toUpperCase() + type.slice(1) },
      ],
    },
    ...kids,
  ];
}
