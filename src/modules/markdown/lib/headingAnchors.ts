import type { HastNode } from "./assetPath";

function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  if (node.tagName === "img") return String(node.properties?.alt ?? "");
  return node.children?.map(textOf).join("") ?? "";
}

export function rehypeHeadingAnchors() {
  return (tree: unknown) => {
    const used = new Set<string>();
    const nextSuffix = new Map<string, number>();
    const visit = (node: HastNode) => {
      if (node.type === "element" && /^h[1-6]$/.test(node.tagName ?? "")) {
        const base = textOf(node)
          .trim()
          .toLowerCase()
          .replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, "")
          .replace(/\s/g, "-");
        if (base) {
          let slug = base;
          let suffix = nextSuffix.get(base) ?? 1;
          while (used.has(slug)) slug = `${base}-${suffix++}`;
          nextSuffix.set(base, suffix);
          used.add(slug);
          // Hidden previews may contain the same headings as the active one.
          node.properties ??= {};
          node.properties.dataMarkdownHeading = slug;
        }
      }
      node.children?.forEach(visit);
    };
    visit(tree as HastNode);
  };
}

export function findMarkdownFragment(root: HTMLElement, fragment: string) {
  let decoded = fragment;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    // The original spelling may still match a heading or an explicit ID.
  }
  const anchors = Array.from(
    root.querySelectorAll("[id], [data-markdown-heading]"),
  );
  return (
    anchors.find((el) => el.id === decoded) ??
    anchors.find(
      (el) => el.getAttribute("data-markdown-heading") === decoded,
    ) ??
    anchors.find((el) => el.id === `user-content-${decoded}`)
  );
}
