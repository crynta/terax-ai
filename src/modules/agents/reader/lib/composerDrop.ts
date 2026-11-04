/**
 * Native OS file drops on the Reader composer, and the composer's one-line vs
 * multi-line layout decision.
 */

/** Extensions attached as images (copied to the pasted-images cache). */
export const DROP_IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
]);
/** Image formats Claude Code can't take, reported instead of attached. */
const UNSUPPORTED_IMAGE_EXTENSIONS = new Set(["heic", "heif", "tif", "tiff"]);

function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export type DropRouting = {
  /** Attach as images. */
  images: string[];
  /** Insert as @path mentions. */
  files: string[];
  /** Images in a format that can't be attached. */
  unsupported: string[];
};

/** Splits dropped paths into images, other files and unsupported images. */
export function routeDroppedPaths(paths: readonly string[]): DropRouting {
  const routing: DropRouting = { images: [], files: [], unsupported: [] };
  for (const path of paths) {
    const ext = extensionOf(path);
    if (DROP_IMAGE_EXTENSIONS.has(ext)) routing.images.push(path);
    else if (UNSUPPORTED_IMAGE_EXTENSIONS.has(ext))
      routing.unsupported.push(path);
    else routing.files.push(path);
  }
  return routing;
}

/** The `@` reference for a dropped file: relative to the session folder when inside it. */
export function dropMentionRef(path: string, cwd: string | null): string {
  if (cwd) {
    const base = cwd.replace(/\/+$/, "");
    if (path.startsWith(`${base}/`)) return path.slice(base.length + 1);
  }
  return path;
}

/**
 * Tauri reports drop positions in physical pixels on some platforms and
 * logical on others: scale down only when the point overflows the viewport.
 */
export function toLogicalPoint(
  x: number,
  y: number,
  viewport: { width: number; height: number; dpr: number },
): { x: number; y: number } {
  if (x > viewport.width || y > viewport.height) {
    const dpr = viewport.dpr || 1;
    return { x: x / dpr, y: y / dpr };
  }
  return { x, y };
}

export function pointInRect(
  point: { x: number; y: number },
  rect: { left: number; top: number; right: number; bottom: number },
): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

/**
 * Whether the draft needs the multi-line layout (text on its own full-width
 * row, controls below): it has a newline, or it doesn't fit beside the controls.
 * Measured against the one-line width so the layout can't flip back and forth.
 */
export function needsMultiline(
  text: string,
  textWidth: number,
  oneLineWidth: number,
): boolean {
  if (text.includes("\n")) return true;
  if (oneLineWidth <= 0) return false;
  return textWidth > oneLineWidth;
}
