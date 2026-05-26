import { invoke } from "@tauri-apps/api/core";
import type { Terminal } from "@xterm/xterm";
import { createExistenceCache } from "./existenceCache";
import { extractPathCandidates } from "./pathMatcher";

/**
 * Path-resolution callbacks the provider needs from its host. Split out so
 * `createSlot` (which doesn't know about React) can wire them via the
 * slot adapter without import cycles.
 */
export interface FileLinkProviderDeps {
  /** Current CWD for this terminal slot — used to resolve relative paths. */
  getCwd(): string | null;
  /** Click handler — fires when the user clicks a verified path link. */
  onClick(absPath: string, line?: number, col?: number): void;
  /** Called when the click target turns out to be missing on disk. */
  onMissing?(absPath: string): void;
}

const cache = createExistenceCache((absPath) =>
  invoke<boolean>("fs_exists", { path: absPath }).catch(() => false),
);

/**
 * Exported for tests / cache invalidation from click-failure paths.
 */
export const fileExistenceCache = cache;

function isAbsolute(p: string): boolean {
  if (p.startsWith("/")) return true;
  if (/^[A-Za-z]:[\\/]/.test(p)) return true;
  // ~ is a shell affordance, not a filesystem one — `fs_exists("~/foo")` would
  // probe a literal "~" directory. Tilde paths are skipped (existence check
  // will return false and they simply won't be underlined).
  return false;
}

function joinCwd(cwd: string, rel: string): string {
  const r = rel.startsWith("./") ? rel.slice(2) : rel;
  const sep = cwd.endsWith("/") ? "" : "/";
  return cwd + sep + r;
}

function resolve(path: string, cwd: string | null): string | null {
  if (isAbsolute(path)) return path;
  if (!cwd) return null;
  return joinCwd(cwd, path);
}

// ILinkProvider, ILink, IBuffer, IBufferLine, IBufferRange are not exported
// from @xterm/xterm, so we use Terminal's structural types directly.
type IBuffer = Terminal["buffer"]["active"];

/** A link object shaped to satisfy xterm's ILink interface. */
type TermLink = ReturnType<typeof toLink>;

/** A link provider shaped to satisfy xterm's ILinkProvider interface. */
export interface FileLinkProvider {
  provideLinks(bufferLineNumber: number, callback: (links: TermLink[] | undefined) => void): void;
}

export function createFileLinkProvider(
  term: Terminal,
  deps: FileLinkProviderDeps,
): FileLinkProvider {
  return {
    provideLinks(bufferLineNumber: number, callback: (links: TermLink[] | undefined) => void) {
      const buf = term.buffer.active;
      const index = bufferLineNumber - 1;
      const line = buf.getLine(index);
      if (!line) {
        callback(undefined);
        return;
      }

      // We tokenize and place link ranges on the *logical* line (joined
      // wrapped continuations). The reported range's y must therefore be the
      // logical-start row, otherwise the underline lands on the wrong cell.
      // The simplest correct behavior: only emit links when xterm asks about
      // the logical-start row itself; continuation rows return no links.
      // Paths that wrap mid-line are clickable only on their starting row —
      // acceptable for v1 and avoids per-row coordinate translation.
      if (line.isWrapped) {
        callback(undefined);
        return;
      }

      const text = readLogicalLine(buf, index);
      const candidates = extractPathCandidates(text);
      if (candidates.length === 0) {
        callback(undefined);
        return;
      }

      const cwd = deps.getCwd();
      void (async () => {
        const verified: ReturnType<typeof toLink>[] = [];
        for (const c of candidates) {
          const abs = resolve(c.path, cwd);
          if (!abs) continue;
          // eslint-disable-next-line no-await-in-loop
          const ok = await cache.exists(abs);
          if (!ok) continue;
          verified.push(
            toLink(c.start + 1, bufferLineNumber, c.text, () => {
              void (async () => {
                const stillOk = await cache.exists(abs);
                if (!stillOk) {
                  cache.invalidate(abs);
                  deps.onMissing?.(abs);
                  return;
                }
                deps.onClick(abs, c.line, c.col);
              })();
            }),
          );
        }
        callback(verified.length ? verified : undefined);
      })();
    },
  };
}

function toLink(
  startColumn: number,
  bufferLineNumber: number,
  text: string,
  activate: () => void,
) {
  const range = {
    start: { x: startColumn, y: bufferLineNumber },
    end: { x: startColumn + text.length - 1, y: bufferLineNumber },
  };
  return {
    range,
    text,
    activate(_event: MouseEvent, _text: string) {
      activate();
    },
  };
}

function readLogicalLine(buf: IBuffer, index: number): string {
  let start = index;
  while (start > 0 && buf.getLine(start)?.isWrapped) start--;
  let out = "";
  for (let i = start; i < buf.length; i++) {
    const ln = buf.getLine(i);
    if (!ln) break;
    if (i > start && !ln.isWrapped) break;
    out += ln.translateToString(true);
  }
  return out;
}
