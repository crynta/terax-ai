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

const LOCAL_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
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

function protocolRelativeWebUrl(href: string): string | undefined {
  if (!href.startsWith("//")) return;
  try {
    return new URL(`https:${href}`).href;
  } catch {
    return undefined;
  }
}

function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

function dirOf(path: string): string {
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

export type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

let nextImageProcessorId = 0;

/**
 * Rehype plugin that rewrites relative `<img src>` to `toUrl(absolutePath)` when
 * `policy` allows it. Document-supplied asset URLs are dropped, and remote
 * images become links for explicit browser opening.
 * It has to run after sanitize (which strips the asset scheme) and before
 * harden (which would block a relative URL it cannot resolve).
 */
export function rehypeLocalImages(
  basePath: string,
  toUrl: (absolutePath: string) => string,
  policy: LocalImagePolicy,
) {
  const rewrite = (node: HastNode, insideLink = false): void => {
    if (node.type === "element" && node.tagName === "img") {
      const src = node.properties?.src;
      if (typeof src === "string" && node.properties) {
        const trimmed = src.trim();
        const abs = resolveRelativeAsset(basePath, trimmed);
        if (abs) {
          if (isAllowedLocalImage(abs, policy)) {
            node.properties.src = toUrl(abs);
          }
        } else if (ASSET_URL.test(trimmed)) {
          delete node.properties.src;
        } else {
          const remote = /^https?:\/\//i.test(trimmed)
            ? trimmed
            : protocolRelativeWebUrl(trimmed);
          if (remote) {
            const alt =
              typeof node.properties.alt === "string"
                ? node.properties.alt
                : "";
            node.tagName = insideLink ? "span" : "a";
            node.properties = insideLink ? {} : { href: remote };
            const label = alt
              ? `Open image in browser: ${alt}`
              : "Open image in browser";
            node.children = [
              {
                type: "text",
                value: insideLink ? alt || "Remote image" : label,
              },
            ];
          }
        }
      }
    }
    const childInsideLink = insideLink || node.tagName === "a";
    node.children?.forEach((child) => {
      rewrite(child, childInsideLink);
    });
  };
  const attacher = () => (tree: unknown) => rewrite(tree as HastNode);
  // Streamdown keys processors by plugin name. This one closes over a grant.
  Object.defineProperty(attacher, "name", {
    value: `rehypeLocalImages_${nextImageProcessorId++}`,
  });
  return attacher;
}

function isBareRelativeHref(href: string): boolean {
  if (
    !href ||
    href.startsWith("#") ||
    href.startsWith("/") ||
    href.startsWith("\\") ||
    href.startsWith("./") ||
    href.startsWith("../")
  ) {
    return false;
  }
  return !URL_SCHEME.test(href);
}

/**
 * rehype-harden blocks bare relative links like `other.md` when it cannot parse
 * them without a default origin. Normalize bare doc-relative hrefs to an
 * explicit relative path and mark local document links so they can be resolved
 * against the markdown file after hardening.
 */
export function rehypeAllowBareRelativeLinks(basePath: string) {
  const rewrite = (node: HastNode): void => {
    if (node.type === "element" && node.tagName === "a") {
      const href = node.properties?.href;
      if (typeof href === "string") {
        const trimmed = href.trim();
        const normalized =
          protocolRelativeWebUrl(trimmed) ??
          (isBareRelativeHref(trimmed) ? `./${trimmed}` : trimmed);
        if (node.properties) {
          node.properties.href = normalized;
          if (resolveRelativeAsset(basePath, normalized) !== null) {
            node.properties["data-doc-href"] = normalized;
          }
        }
      }
    }
    node.children?.forEach(rewrite);
  };
  return () => (tree: unknown) => rewrite(tree as HastNode);
}

/** Restores doc-relative hrefs preserved before hardening. */
export function rehypeRestoreDocHrefs() {
  const rewrite = (node: HastNode): void => {
    if (node.type === "element" && node.tagName === "a" && node.properties) {
      const docHref = node.properties["data-doc-href"];
      if (typeof docHref === "string") node.properties.href = docHref;
    }
    node.children?.forEach(rewrite);
  };
  return () => (tree: unknown) => rewrite(tree as HastNode);
}
