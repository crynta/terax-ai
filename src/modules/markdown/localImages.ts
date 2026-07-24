/**
 * Local image resolution: a relative img src in a previewed file (img.png,
 * ./a/b.png, ../x.png) resolves against the document's directory and loads
 * through Tauri's asset protocol via convertFileSrc, the maintainer-preferred
 * zero-copy path (#572, #314; EditorPane precedent). http(s), data: and any
 * other absolute URL stay untouched.
 *
 * Runs before rehype-sanitize/rehype-harden on purpose: harden blocks
 * relative srcs (imageBlockPolicy "text-only"), so the rewrite must happen
 * first. The converted URL then survives sanitize through its protocol
 * allowlist (http on Windows, the enumerated asset scheme elsewhere) and
 * harden's wildcard prefixes. A missing file is served as a protocol error
 * the img element renders as the standard broken-image/alt state.
 */
import { convertFileSrc } from "@tauri-apps/api/core";
import type { HNode } from "./tableDirectives";

export function rehypeLocalImages(baseDir?: string) {
  return (tree: unknown) => {
    if (baseDir) visit(tree as HNode, baseDir);
  };
}

function visit(node: HNode, baseDir: string): void {
  if (node.type === "element" && node.tagName === "img") {
    const src = node.properties?.src;
    if (typeof src === "string" && isRelative(src)) {
      node.properties = {
        ...node.properties,
        src: convertFileSrc(joinPath(baseDir, decodeSrc(src))),
      };
    }
  }
  for (const child of node.children ?? []) {
    visit(child, baseDir);
  }
}

// Anything that parses as a URL has a scheme (http, https, data, asset,
// mailto; a Windows drive path like C:/x.png parses with a "c:" scheme) and
// stays untouched; the sanitizer's protocol allowlist decides its fate.
// ponytail: root-absolute srcs ("/assets/x.png") resolve against the repo
// root on GitHub, but no workspace-root path is available in this module,
// so they pass through unresolved and render as the browser's silent
// broken-image/alt state; resolve against the workspace root if a root
// store ever lands.
function isRelative(src: string): boolean {
  if (src.startsWith("/")) return false;
  try {
    new URL(src);
    return false;
  } catch {
    return true;
  }
}

// Markdown authors percent-encode spaces and # in paths (my%20shot.png);
// the joined filesystem path needs the real file name, and convertFileSrc
// re-encodes it for the URL, so decode exactly once before joining.
function decodeSrc(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    // Malformed escape: treat the src as a literal file name.
    return src;
  }
}

/**
 * Lexical join + normalize with forward slashes throughout (Tauri accepts
 * them on Windows). ".." never climbs past the root (drive letter, UNC
 * lead-in or "/"); traversal above the workspace stays allowed on purpose,
 * matching the editor's preview of arbitrary paths under the shipped
 * assetProtocol scope of ["**"].
 */
export function joinPath(dir: string, rel: string): string {
  const parts = `${dir}/${rel}`.replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "") {
      // Keep leading empties ("/x" and UNC "//server/share"), drop the rest.
      if (out.length === 0 || out[out.length - 1] === "") out.push(part);
      continue;
    }
    if (part === "..") {
      const last = out[out.length - 1];
      if (last !== undefined && last !== "" && !/^[A-Za-z]:$/.test(last)) {
        out.pop();
      }
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

/** Directory of a file path; handles / and \ separators. "" when none. */
export function parentDir(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (i < 0) return "";
  return i === 0 ? path.slice(0, 1) : path.slice(0, i);
}
