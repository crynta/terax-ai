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

export const LOCAL_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "svg",
  "bmp",
  "ico",
]);

const ASSET_URL = /^(?:asset:|(?:https?:)?\/\/asset\.localhost)/i;

function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

export function dirOf(path: string): string {
  const posix = toPosix(path);
  const i = posix.lastIndexOf("/");
  return i <= 0 ? posix.slice(0, i + 1) : posix.slice(0, i);
}

/** Lexical containment; `abs` must already be normalized (no `..`). */
export function isInsideRoot(root: string, abs: string): boolean {
  let r = toPosix(root).replace(/\/+$/, "");
  let a = toPosix(abs);
  if (/^[a-zA-Z]:/.test(r)) {
    r = r.toLowerCase();
    a = a.toLowerCase();
  }
  return a.startsWith(`${r}/`);
}

/**
 * The tree a preview may load images from: the workspace root when the
 * document lives in it, otherwise the document's own folder.
 */
export function previewBoundary(
  docPath: string,
  workspaceRoot: string | null,
): string {
  return workspaceRoot && isInsideRoot(workspaceRoot, docPath)
    ? workspaceRoot
    : dirOf(docPath);
}

export type LocalImagePolicy = {
  boundary: string;
  /** False for secret paths; the AI tools' read guard in production. */
  isReadable: (absolutePath: string) => boolean;
};

/**
 * The asset protocol is scoped to the whole disk, so a preview may only turn a
 * path into an asset URL when it stays under `boundary`, is an image type and
 * is not a secret path. Symlinks are not resolved here.
 */
export function isAllowedLocalImage(
  abs: string,
  policy: LocalImagePolicy,
): boolean {
  const name = toPosix(abs).split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return (
    LOCAL_IMAGE_EXTENSIONS.has(ext) &&
    isInsideRoot(policy.boundary, abs) &&
    policy.isReadable(abs)
  );
}

type HastNode = {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/**
 * Rehype plugin that rewrites relative `<img src>` to `toUrl(absolutePath)` when
 * `policy` allows it. A relative path it refuses stays as written (it will not
 * load), and a document-supplied asset-protocol URL is dropped outright.
 * It has to run after sanitize (which strips the asset scheme) and before
 * harden (which would block a relative URL it cannot resolve).
 */
export function rehypeLocalImages(
  basePath: string,
  toUrl: (absolutePath: string) => string,
  policy: LocalImagePolicy,
) {
  const rewrite = (node: HastNode): void => {
    if (node.type === "element" && node.tagName === "img") {
      const src = node.properties?.src;
      if (typeof src === "string" && node.properties) {
        const abs = resolveRelativeAsset(basePath, src);
        if (abs) {
          if (isAllowedLocalImage(abs, policy)) {
            node.properties.src = toUrl(abs);
          }
        } else if (ASSET_URL.test(src.trim())) {
          delete node.properties.src;
        }
      }
    }
    node.children?.forEach(rewrite);
  };
  return () => (tree: unknown) => rewrite(tree as HastNode);
}
