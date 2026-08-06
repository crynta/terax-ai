// Relative img srcs resolve against the document's directory and load
// through Tauri's asset protocol. Must run before sanitize/harden, which
// would block relative srcs; the rewritten URL passes the allowlist.
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

// Anything with a scheme (http, data, even a C:/ drive path) is left for
// the sanitizer's protocol allowlist to vet. Root-absolute srcs ("/x.png")
// would need a workspace root to resolve like GitHub; unresolved for now.
function isRelative(src: string): boolean {
  if (src.startsWith("/")) return false;
  try {
    new URL(src);
    return false;
  } catch {
    return true;
  }
}

// Authors percent-encode paths (my%20shot.png); decode exactly once before
// joining, convertFileSrc re-encodes for the URL.
function decodeSrc(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    // Malformed escape: treat the src as a literal file name.
    return src;
  }
}

// Lexical join/normalize with forward slashes (Tauri accepts them on
// Windows). ".." never climbs past a root; traversal above the workspace is
// deliberate, matching the editor under the shipped assetProtocol ["**"].
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

/** Parent directory; "" when the path has no separator. */
export function parentDir(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (i < 0) return "";
  return i === 0 ? path.slice(0, 1) : path.slice(0, i);
}
