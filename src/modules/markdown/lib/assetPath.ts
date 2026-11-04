// Pure helpers for pointing a markdown file's relative images at disk.

const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/;
const URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * Absolute path of `src` as the markdown file at `base` would resolve it, or
 * null when `src` is not a plain relative reference (remote, data:, anchor,
 * root-relative or empty). Query and fragment are dropped and percent escapes
 * decoded, as a browser would before asking the file system.
 */
export function resolveRelativeAsset(base: string, src: string): string | null {
  const bare = src.trim().split(/[?#]/)[0];
  if (!bare || bare.startsWith("/") || bare.startsWith("\\")) return null;
  if (WINDOWS_DRIVE.test(bare)) return null;
  if (URL_SCHEME.test(bare)) return null;

  let decoded = bare;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    /* keep the raw text */
  }

  const backslashes = base.includes("\\") && !base.includes("/");
  const dirEnd = Math.max(base.lastIndexOf("/"), base.lastIndexOf("\\"));
  if (dirEnd < 0) return null;
  const [root, ...stack] = base.slice(0, dirEnd).replace(/\\/g, "/").split("/");

  for (const part of decoded.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  const joined = [root, ...stack].join("/");
  return backslashes ? joined.replace(/\//g, "\\") : joined;
}

type HastNode = {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/**
 * Rehype plugin that rewrites relative `<img src>` to `toUrl(absolutePath)`.
 * It has to run after sanitize (which strips the asset scheme) and before
 * harden (which would block a relative URL it cannot resolve).
 */
export function rehypeLocalImages(
  basePath: string,
  toUrl: (absolutePath: string) => string,
) {
  const rewrite = (node: HastNode): void => {
    if (node.type === "element" && node.tagName === "img") {
      const src = node.properties?.src;
      if (typeof src === "string") {
        const abs = resolveRelativeAsset(basePath, src);
        if (abs && node.properties) node.properties.src = toUrl(abs);
      }
    }
    node.children?.forEach(rewrite);
  };
  return () => (tree: unknown) => rewrite(tree as HastNode);
}
