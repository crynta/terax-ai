import { isExternalUrl, logLink, openExternalUrl } from "@/lib/external-link";
import { currentWorkspaceEnv } from "@/modules/workspace/env";
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";

export type TerminalFileTarget = { path: string; line?: number };

export type TerminalFileOpener = (path: string, line?: number) => void;

let opener: TerminalFileOpener | null = null;

/** The app registers how a clicked terminal path opens in the editor. */
export function setTerminalFileOpener(next: TerminalFileOpener | null): void {
  opener = next;
}

/** A link under the pointer in some pane, for the floating link chip. */
export type TerminalLinkHoverEvent = {
  uri: string;
  rect: { left: number; top: number; right: number; bottom: number };
  leafId: number;
  cwd: string | null;
};

type TerminalLinkHoverListener = (event: TerminalLinkHoverEvent | null) => void;

let hoverListener: TerminalLinkHoverListener | null = null;

/** The link chip registers here; a terminal surface only ever calls {@link emitTerminalLinkHover}. */
export function setTerminalLinkHoverListener(
  next: TerminalLinkHoverListener | null,
): void {
  hoverListener = next;
}

export function emitTerminalLinkHover(
  event: TerminalLinkHoverEvent | null,
): void {
  hoverListener?.(event);
}

/** The file a link points at, resolved like a click would, or null for URLs and unknown bases. */
export function resolveTerminalFileLink(
  uri: string,
  cwd: string | null,
): TerminalFileTarget | null {
  return parseTerminalFileLink(uri, cwd, cachedHome);
}

let cachedHome: string | null = null;
void homeDir()
  .then((h) => {
    cachedHome = h.replace(/\\/g, "/").replace(/\/+$/, "");
  })
  .catch(() => {});

/**
 * Resolves a terminal link to a file: a `file://` URI (OSC 8) or a printed path such as
 * `src/a.ts:12:3`, `./a.ts` or `~/a.md`. Relative paths resolve against `cwd`. Returns null
 * for other schemes, or when the base a path needs is unknown.
 */
export function parseTerminalFileLink(
  uri: string,
  cwd: string | null,
  home: string | null,
): TerminalFileTarget | null {
  let text = uri;
  let hashLine: number | undefined;
  if (/^file:/i.test(uri)) {
    try {
      const parsed = new URL(uri);
      text = decodeURIComponent(parsed.pathname);
      const hash = parsed.hash.match(/^#L?(\d+)/i);
      if (hash) hashLine = Number(hash[1]);
    } catch {
      return null;
    }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) {
    return null;
  }
  const suffix = text.match(/:(\d+)(?::\d+)?$/);
  if (suffix) text = text.slice(0, suffix.index);
  let base: string;
  if (text.startsWith("/")) base = "";
  else if (text === "~" || text.startsWith("~/")) {
    if (!home) return null;
    base = home;
    text = text.slice(1);
  } else {
    if (!cwd) return null;
    base = cwd;
  }
  const path = normalizePath(`${base}/${text}`);
  if (path === "/") return null;
  const line = suffix ? Number(suffix[1]) : hashLine;
  return line && line > 0 ? { path, line } : { path };
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/**
 * Opens a clicked terminal link: web links in the browser, files that exist in the editor
 * (at the printed line). `onSettled` hands focus back to the terminal when nothing opened
 * in the editor.
 */
export async function openTerminalLink(
  uri: string,
  cwd: string | null,
  onSettled?: () => void,
): Promise<void> {
  if (isExternalUrl(uri)) return openExternalUrl(uri, onSettled);
  const target = parseTerminalFileLink(uri, cwd, cachedHome);
  const open = opener;
  if (!target) logLink("open file skipped (not resolvable)");
  else if (!open) logLink("open file skipped (no editor opener)", true);
  if (target && open) {
    const stat = await invoke<{ kind: string }>("fs_stat", {
      path: target.path,
      workspace: currentWorkspaceEnv(),
    }).catch(() => null);
    if (stat && stat.kind !== "dir") {
      open(target.path, target.line);
      logLink(`open file ok${target.line ? ` (line ${target.line})` : ""}`);
      return;
    }
    logLink(
      stat ? "open file skipped (a folder)" : "open file skipped (missing)",
    );
  }
  onSettled?.();
}
