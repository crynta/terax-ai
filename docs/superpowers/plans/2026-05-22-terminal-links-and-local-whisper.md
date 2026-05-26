# Clickable terminal paths + local Whisper — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two independent features in one branch: (1) clickable file paths in the terminal that open in an in-app editor tab with line:col jump, gated by an existence check; (2) provider-selectable voice transcription with an in-browser Whisper default so voice input no longer requires an OpenAI key.

**Architecture:**
- Terminal links: a custom xterm `registerLinkProvider` runs alongside `WebLinksAddon`. It tokenizes path candidates, cheap-rejects obvious non-files, resolves against the leaf's OSC-7-tracked CWD, and probes existence via a new `fs_exists` Tauri command behind an LRU cache. Clicking calls a new `SlotAdapter.openFile(path, line?, col?)` populated by `App.tsx`, which calls `openFileTab(path, false, { line, col })`. `EditorPane` consumes a one-shot `pendingSelection` on the tab.
- Local Whisper: `@huggingface/transformers` runs in a Web Worker; the existing `useWhisperRecording` hook is refactored behind a `Transcriber` interface with two implementations (OpenAI cloud / local in-app). Settings expose a `voiceProvider` toggle. Local is the default. The mic button stops requiring an OpenAI key.

**Tech Stack:** TypeScript, React 19, Vite 7, Tauri 2 (Rust), xterm.js 6 + addons, CodeMirror 6, @uiw/react-codemirror, Zustand, vitest, `@huggingface/transformers` (new), AI SDK 6.

**Specification:** `docs/superpowers/specs/2026-05-22-terminal-links-and-local-whisper-design.md`

---

## Codebase orientation (read before starting)

- **Terminal renderer pool:** `src/modules/terminal/lib/rendererPool.ts`. `createSlot()` (line 114) is where xterm addons are loaded — that's where the new link provider goes. `SlotAdapter` (line 18) is the bridge between the pool and per-leaf React state; it's the right place to add `getCwd` + `openFile`.
- **Pool wiring:** `src/modules/terminal/lib/useTerminalSession.ts:61` is the *single* call to `configureRendererPool({...})`. Each leaf's `Session` already tracks `lastCwd` (line 38) populated by the OSC 7 handler. We expose it through `SlotAdapter`.
- **OSC 7 handler:** `src/modules/terminal/lib/osc-handlers.ts:19` already gives us secure (post-command) cwd updates per leaf.
- **Tabs API:** `src/modules/tabs/lib/useTabs.ts:205` exports `openFileTab(path, pin)`. Already wired through `App.tsx:155, 539, 792`. We add an optional 3rd `selection` parameter.
- **Editor pane:** `src/modules/editor/EditorPane.tsx` — `cmRef.current?.view` is the CodeMirror `EditorView` we dispatch onto. The `path` prop is the only identifier; selection has to be threaded as a separate prop.
- **Whisper hook:** `src/modules/ai/hooks/useWhisperRecording.ts` — single file, ~115 lines. Replaced by a thinner orchestrator that delegates to a `Transcriber`.
- **Mic UI:** `src/modules/ai/components/AiStatusBarControls.tsx:125-153`. Status text echo in `src/modules/ai/components/AiInputBar.tsx:210`.
- **Composer plumbing:** `src/modules/ai/lib/composer.tsx:148` calls `useWhisperRecording`. The hook's return shape is the public API consumed by `AiStatusBarControls` and `AiInputBar` — extending it is the lowest-impact path.
- **Preferences:** `src/modules/settings/store.ts` holds the schema, persistence, and setters (Tauri `LazyStore`). `src/modules/settings/preferences.ts` is the Zustand store layered on top. New prefs need entries in both files plus a key in the `onPreferencesChange` mapper at the bottom of `store.ts`.
- **Rust commands:** `src-tauri/src/modules/fs/file.rs` already has `fs_read_file`, `fs_write_file`, `fs_canonicalize`, `fs_stat`. Same pattern (`#[tauri::command]`, `WorkspaceEnv` arg, `resolve_path` from `crate::modules::workspace`). Commands are registered in `src-tauri/src/lib.rs:121-148` inside `invoke_handler!`.
- **Tests:** Vitest. Existing tests at `src/modules/preview/PreviewPane.test.ts`, `src/modules/terminal/lib/osc-handlers.test.ts`, `src/modules/ai/lib/security.test.ts`. Run with `pnpm test`.

---

# Feature A — Clickable terminal paths

## Task A1: Add `fs_exists` Rust command

**Files:**
- Modify: `src-tauri/src/modules/fs/file.rs:1-200`
- Modify: `src-tauri/src/lib.rs:121-148`

- [ ] **Step 1: Add the command implementation**

Add this at the end of `src-tauri/src/modules/fs/file.rs`, before the `#[cfg(all(test, unix))] mod tests {` block:

```rust
#[tauri::command]
pub fn fs_exists(path: String, workspace: Option<WorkspaceEnv>) -> Result<bool, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    let p = resolve_path(&path, &workspace);
    // `try_exists` distinguishes "definitely missing" from "couldn't check"
    // (permission errors, broken filesystem). For terminal click-to-open
    // we collapse both into "not clickable" — false is the safe default.
    Ok(p.try_exists().unwrap_or(false))
}
```

- [ ] **Step 2: Register the command**

In `src-tauri/src/lib.rs`, find the `invoke_handler![` block (line 121) and add `fs::file::fs_exists,` immediately after the existing `fs::file::fs_canonicalize,` line:

```rust
            fs::file::fs_read_file,
            fs::file::fs_write_file,
            fs::file::fs_stat,
            fs::file::fs_canonicalize,
            fs::file::fs_exists,
            fs::mutate::fs_create_file,
```

- [ ] **Step 3: Verify Rust build**

Run: `cd src-tauri && cargo check`
Expected: succeeds with no errors. The new command compiles and is referenced by the handler macro.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/modules/fs/file.rs src-tauri/src/lib.rs
git commit -m "feat(fs): add fs_exists tauri command"
```

---

## Task A2: Path-candidate matcher

**Files:**
- Create: `src/modules/terminal/lib/pathMatcher.ts`
- Create: `src/modules/terminal/lib/pathMatcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/terminal/lib/pathMatcher.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractPathCandidates } from "./pathMatcher";

describe("extractPathCandidates", () => {
  it("matches a relative compiler path with line and col", () => {
    const out = extractPathCandidates("src/foo.ts:42:5: error TS2322: …");
    expect(out).toEqual([
      { text: "src/foo.ts:42:5", start: 0, end: 15, path: "src/foo.ts", line: 42, col: 5 },
    ]);
  });

  it("matches a relative path with only a line number", () => {
    const out = extractPathCandidates("see ./bar.rs:7 for details");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ path: "./bar.rs", line: 7, col: undefined });
  });

  it("matches an absolute path", () => {
    const out = extractPathCandidates("opened /etc/hosts");
    expect(out).toEqual([
      { text: "/etc/hosts", start: 7, end: 17, path: "/etc/hosts", line: undefined, col: undefined },
    ]);
  });

  it("matches a Windows-style drive path", () => {
    const out = extractPathCandidates("see C:\\Users\\me\\notes.md");
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe("C:\\Users\\me\\notes.md");
  });

  it("matches a bare filename with extension", () => {
    const out = extractPathCandidates("touched README.md and package.json");
    expect(out.map((c) => c.path)).toEqual(["README.md", "package.json"]);
  });

  it("rejects URLs (left to WebLinksAddon)", () => {
    expect(extractPathCandidates("see https://example.com/foo.ts")).toEqual([]);
  });

  it("rejects semver, hex hashes, and bare numbers", () => {
    expect(extractPathCandidates("version 1.2.3 sha abc1234def5 num 12.345")).toEqual([]);
  });

  it("rejects timestamps", () => {
    expect(extractPathCandidates("[2026-05-22T12:34:56] hi")).toEqual([]);
  });

  it("skips lines longer than 1024 chars", () => {
    const big = "a".repeat(1100) + " /etc/hosts";
    expect(extractPathCandidates(big)).toEqual([]);
  });

  it("caps results at 32 per line", () => {
    const tokens = Array.from({ length: 50 }, (_, i) => `f${i}.ts`).join(" ");
    expect(extractPathCandidates(tokens).length).toBeLessThanOrEqual(32);
  });

  it("preserves correct ranges for multiple matches", () => {
    const line = "a.ts and b.ts";
    const out = extractPathCandidates(line);
    expect(out).toEqual([
      { text: "a.ts", start: 0, end: 4, path: "a.ts", line: undefined, col: undefined },
      { text: "b.ts", start: 9, end: 13, path: "b.ts", line: undefined, col: undefined },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/modules/terminal/lib/pathMatcher.test.ts`
Expected: FAIL — `Cannot find module './pathMatcher'`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/terminal/lib/pathMatcher.ts`:

```ts
/**
 * Match file-path candidates in a single terminal line. The output is
 * deliberately permissive — false positives are filtered later by an
 * existence check against the filesystem. We only do *cheap* rejection
 * here for tokens that obviously cannot be files (URLs, semver, hashes,
 * timestamps), to avoid wasting fs probes.
 *
 * Each result includes the byte range *in the input line* so xterm can
 * convert it to a buffer-cell range for underline + click hit-testing.
 */
export interface PathCandidate {
  /** The exact substring as it appears in the line. */
  text: string;
  /** Inclusive start index into the line. */
  start: number;
  /** Exclusive end index into the line. */
  end: number;
  /** The file-path part (without trailing `:line[:col]`). */
  path: string;
  line?: number;
  col?: number;
}

const MAX_LINE_LENGTH = 1024;
const MAX_TOKEN_LENGTH = 512;
const MAX_CANDIDATES_PER_LINE = 32;

// Matches:
//   /abs/path  (POSIX absolute)
//   ~/path     (tilde — caller can choose whether to expand)
//   ./rel  ../rel  multi/segment/path
//   bare.ext   (single token containing a dot)
//   C:\Win\path  C:/Win/path
// Each may be suffixed with :LINE[:COL].
//
// Allowed path chars: letters, digits, _ - . / \ ~ (no spaces, no quotes,
// no parentheses — those are line-noise around real paths).
const PATH_REGEX =
  /(?:[A-Za-z]:[\\/])?(?:\.{1,2}[\\/])?[A-Za-z0-9_~][A-Za-z0-9_./\\-]*(?::(\d+)(?::(\d+))?)?/g;

const URL_REGEX = /:\/\//;
// Pure number (123 or 12.345) — no slash, no letter.
const PURE_NUMBER_REGEX = /^\d+(?:\.\d+)*$/;
// Semver-ish: 1.2.3, 1.2.3-rc.1, 1.2 — three+ dot groups of digits.
const SEMVER_REGEX = /^\d+\.\d+(?:\.\d+)(?:[.\-][A-Za-z0-9]+)*$/;
// Hex hash: 7+ hex chars, no dot, no slash.
const HEX_HASH_REGEX = /^[0-9a-f]{7,}$/i;
// ISO timestamp fragment (heuristic — Real ones contain `T` and colons).
const TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function looksLikeNonPath(token: string): boolean {
  if (token.length > MAX_TOKEN_LENGTH) return true;
  if (URL_REGEX.test(token)) return true;
  if (PURE_NUMBER_REGEX.test(token)) return true;
  if (SEMVER_REGEX.test(token)) return true;
  if (HEX_HASH_REGEX.test(token)) return true;
  if (TIMESTAMP_REGEX.test(token)) return true;
  // Pure single-word tokens with no slash, no dot — not a path.
  if (!token.includes("/") && !token.includes("\\") && !token.includes(".")) {
    return true;
  }
  // A bare-filename candidate must have a real extension (1-6 letter/digit chars
  // after the final dot). "foo." or "foo.123" are not files; "foo.ts" / "foo.md" are.
  if (!token.includes("/") && !token.includes("\\")) {
    const dot = token.lastIndexOf(".");
    if (dot < 0) return true;
    const ext = token.slice(dot + 1);
    if (!/^[A-Za-z][A-Za-z0-9]{0,5}$/.test(ext)) return true;
  }
  return false;
}

export function extractPathCandidates(line: string): PathCandidate[] {
  if (line.length > MAX_LINE_LENGTH) return [];

  const out: PathCandidate[] = [];
  // Reset the regex's lastIndex — the `g` flag preserves state across calls.
  PATH_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATH_REGEX.exec(line)) !== null) {
    if (out.length >= MAX_CANDIDATES_PER_LINE) break;
    const text = match[0];
    const start = match.index;
    const end = start + text.length;
    const lineNum = match[1] ? Number(match[1]) : undefined;
    const colNum = match[2] ? Number(match[2]) : undefined;
    // Strip the suffix to get the bare path.
    let path = text;
    if (lineNum !== undefined) {
      const colonIdx = text.indexOf(":", text.startsWith("C:") ? 2 : 0);
      if (colonIdx > 0) path = text.slice(0, colonIdx);
    }
    if (looksLikeNonPath(path)) continue;
    out.push({ text, start, end, path, line: lineNum, col: colNum });
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/modules/terminal/lib/pathMatcher.test.ts`
Expected: all 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/terminal/lib/pathMatcher.ts src/modules/terminal/lib/pathMatcher.test.ts
git commit -m "feat(terminal): path-candidate matcher for clickable links"
```

---

## Task A3: Existence cache (LRU with TTL)

**Files:**
- Create: `src/modules/terminal/lib/existenceCache.ts`
- Create: `src/modules/terminal/lib/existenceCache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/terminal/lib/existenceCache.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createExistenceCache } from "./existenceCache";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("existenceCache", () => {
  it("calls the probe once per path and caches the result", async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const cache = createExistenceCache(probe);

    await expect(cache.exists("/a")).resolves.toBe(true);
    await expect(cache.exists("/a")).resolves.toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("re-probes a positive entry after positive TTL elapses", async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const cache = createExistenceCache(probe);

    await cache.exists("/a");
    vi.advanceTimersByTime(31_000);
    await cache.exists("/a");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("re-probes a negative entry after the shorter negative TTL", async () => {
    const probe = vi.fn().mockResolvedValue(false);
    const cache = createExistenceCache(probe);

    await cache.exists("/missing");
    vi.advanceTimersByTime(6_000);
    await cache.exists("/missing");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("invalidates an entry explicitly", async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const cache = createExistenceCache(probe);

    await cache.exists("/a");
    cache.invalidate("/a");
    await cache.exists("/a");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("evicts the least-recently-used entry past capacity", async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const cache = createExistenceCache(probe, { capacity: 2 });

    await cache.exists("/a");
    await cache.exists("/b");
    await cache.exists("/c"); // evicts /a
    await cache.exists("/a"); // re-probe after eviction
    expect(probe).toHaveBeenCalledTimes(4);
  });

  it("coalesces concurrent probes of the same path", async () => {
    let resolve!: (v: boolean) => void;
    const probe = vi.fn(
      () => new Promise<boolean>((r) => { resolve = r; }),
    );
    const cache = createExistenceCache(probe);

    const p1 = cache.exists("/slow");
    const p2 = cache.exists("/slow");
    expect(probe).toHaveBeenCalledTimes(1);
    resolve(true);
    await expect(p1).resolves.toBe(true);
    await expect(p2).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/modules/terminal/lib/existenceCache.test.ts`
Expected: FAIL — `Cannot find module './existenceCache'`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/terminal/lib/existenceCache.ts`:

```ts
/**
 * LRU cache wrapping an async existence probe. Designed for the terminal
 * link-provider hot path: we may probe the same path many times per second
 * as the user scrolls and hovers, and want stale-while-valid semantics.
 *
 * Positive entries live longer than negatives because a file appearing
 * is more common than one vanishing in a terminal session, and the
 * worst-case for a stale positive (one missed underline) is far less
 * disruptive than the worst-case for a stale negative (perpetually
 * un-clickable file the user just created).
 */
export interface ExistenceCacheOptions {
  capacity?: number;
  positiveTtlMs?: number;
  negativeTtlMs?: number;
  /** Defaults to `Date.now`. Vitest can swap with `vi.useFakeTimers`. */
  now?: () => number;
}

export interface ExistenceCache {
  exists(path: string): Promise<boolean>;
  invalidate(path: string): void;
  clear(): void;
}

type Entry = { value: boolean; expiresAt: number };

const DEFAULTS = {
  capacity: 4096,
  positiveTtlMs: 30_000,
  negativeTtlMs: 5_000,
};

export function createExistenceCache(
  probe: (path: string) => Promise<boolean>,
  opts: ExistenceCacheOptions = {},
): ExistenceCache {
  const capacity = opts.capacity ?? DEFAULTS.capacity;
  const posTtl = opts.positiveTtlMs ?? DEFAULTS.positiveTtlMs;
  const negTtl = opts.negativeTtlMs ?? DEFAULTS.negativeTtlMs;
  const now = opts.now ?? Date.now;

  // Map preserves insertion order, so we can re-insert on hit to bump LRU
  // recency without a separate list. Eviction = drop the first key.
  const entries = new Map<string, Entry>();
  const inflight = new Map<string, Promise<boolean>>();

  function bump(key: string, entry: Entry) {
    entries.delete(key);
    entries.set(key, entry);
    while (entries.size > capacity) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }

  return {
    async exists(path) {
      const cached = entries.get(path);
      if (cached && cached.expiresAt > now()) {
        bump(path, cached);
        return cached.value;
      }

      const pending = inflight.get(path);
      if (pending) return pending;

      const probePromise = (async () => {
        try {
          const result = await probe(path);
          bump(path, {
            value: result,
            expiresAt: now() + (result ? posTtl : negTtl),
          });
          return result;
        } finally {
          inflight.delete(path);
        }
      })();
      inflight.set(path, probePromise);
      return probePromise;
    },

    invalidate(path) {
      entries.delete(path);
    },

    clear() {
      entries.clear();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/modules/terminal/lib/existenceCache.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/terminal/lib/existenceCache.ts src/modules/terminal/lib/existenceCache.test.ts
git commit -m "feat(terminal): LRU+TTL existence cache for link provider"
```

---

## Task A4: Extend `SlotAdapter` with `getCwd` and `openFile`

**Files:**
- Modify: `src/modules/terminal/lib/rendererPool.ts:18-22`
- Modify: `src/modules/terminal/lib/useTerminalSession.ts:61-96`

This task only widens the adapter interface and wires the per-leaf cwd through. The link provider is created in a later task and will consume these.

- [ ] **Step 1: Extend the `SlotAdapter` type**

In `src/modules/terminal/lib/rendererPool.ts`, replace lines 18-22:

```ts
export type SlotAdapter = {
  resolveLeaf(leafId: number): LeafBridge | null;
  evictLeaf(leafId: number): void;
  isLeafFocused(leafId: number): boolean;
  /** Current CWD for the leaf, or null if no OSC 7 was ever received. */
  getCwd(leafId: number): string | null;
  /**
   * Open `path` in the editor pane. `path` may be relative; the adapter
   * resolves it against `getCwd(leafId)` if so. Returns a promise that
   * resolves to true on success, false if the file no longer exists.
   */
  openFile(leafId: number, path: string, line?: number, col?: number): Promise<boolean>;
};
```

- [ ] **Step 2: Implement `getCwd` and stub `openFile` in `useTerminalSession.ts`**

In `src/modules/terminal/lib/useTerminalSession.ts`, replace the `configureRendererPool({...})` call (starting line 61) with:

```ts
configureRendererPool({
  resolveLeaf(leafId) {
    const s = sessions.get(leafId);
    if (!s) return null;
    return {
      writeToPty: (data) => {
        s.pty?.write(data);
      },
      resizePty: (cols, rows) => {
        s.cols = cols;
        s.rows = rows;
        s.pty?.resize(cols, rows);
      },
      kickPty: (cols, rows) => {
        const pty = s.pty;
        if (!pty || cols <= 0 || rows <= 0) return;
        pty
          .resize(cols, rows + 1)
          .then(() => pty.resize(cols, rows))
          .catch((e) => console.warn("[terax] kickPty failed:", e));
      },
    };
  },
  evictLeaf(leafId) {
    const s = sessions.get(leafId);
    if (!s) return;
    unbindLeafFromSlot(leafId, s);
  },
  isLeafFocused(leafId) {
    const s = sessions.get(leafId);
    return !!s && s.visibleNow && s.focusedNow;
  },
  getCwd(leafId) {
    const s = sessions.get(leafId);
    return s?.lastCwd ?? null;
  },
  openFile: async (_leafId, _path, _line, _col) => {
    // Wired from App.tsx in a later task. Default no-op so the link
    // provider can still run before App is mounted.
    return false;
  },
});
```

- [ ] **Step 3: Add a runtime hook so `App.tsx` can replace `openFile`**

Still in `src/modules/terminal/lib/useTerminalSession.ts`, immediately after the `configureRendererPool({...})` call, add:

```ts
let openFileHandler: SlotAdapter["openFile"] = async () => false;

export function setTerminalOpenFileHandler(handler: SlotAdapter["openFile"]): void {
  openFileHandler = handler;
}
```

Then change the `openFile` field inside the `configureRendererPool` call from the stub to:

```ts
  openFile: (leafId, path, line, col) => openFileHandler(leafId, path, line, col),
```

You'll also need to add the `SlotAdapter` import to the existing import block at the top of the file:

```ts
import {
  acquireSlot,
  applyBackgroundActive,
  applyFontFamily,
  applyFontSize,
  applyLetterSpacing,
  applyTheme as applyPoolTheme,
  applyScrollback,
  applyWebglPreference,
  configureRendererPool,
  focusSlot,
  getSlotForLeaf,
  releaseSlot,
  setSlotFocused,
  type SlotAdapter,
} from "./rendererPool";
```

- [ ] **Step 4: Verify the project still builds**

Run: `pnpm build`
Expected: build succeeds. (We have not yet *consumed* `getCwd`/`openFile`, just widened the interface.)

- [ ] **Step 5: Commit**

```bash
git add src/modules/terminal/lib/rendererPool.ts src/modules/terminal/lib/useTerminalSession.ts
git commit -m "feat(terminal): widen SlotAdapter with getCwd + openFile"
```

---

## Task A5: The link provider — combines matcher, cache, cwd, fs probe

**Files:**
- Create: `src/modules/terminal/lib/fileLinkProvider.ts`

- [ ] **Step 1: Implement the provider**

Create `src/modules/terminal/lib/fileLinkProvider.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { ILinkProvider, IBufferLine, IViewportRange, Terminal } from "@xterm/xterm";
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
  if (p.startsWith("~/")) return true;
  if (/^[A-Za-z]:[\\/]/.test(p)) return true;
  return false;
}

function joinCwd(cwd: string, rel: string): string {
  // Strip leading "./". Don't try to collapse ".." here — the OS will
  // do it on the Rust side when we canonicalize for the fs probe.
  const r = rel.startsWith("./") ? rel.slice(2) : rel;
  const sep = cwd.endsWith("/") ? "" : "/";
  return cwd + sep + r;
}

function resolve(path: string, cwd: string | null): string | null {
  if (isAbsolute(path)) return path;
  if (!cwd) return null; // No cwd → can't resolve relative paths safely.
  return joinCwd(cwd, path);
}

export function createFileLinkProvider(
  term: Terminal,
  deps: FileLinkProviderDeps,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber: number, callback: (links: ReturnType<typeof toLink>[] | undefined) => void) {
      const buf = term.buffer.active;
      const line = buf.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }

      // xterm gives bufferLineNumber as 1-based; getLine is 0-based. We also
      // need to coalesce wrapped lines so a path split across two cells
      // gets matched as one string.
      const text = readLogicalLine(buf, bufferLineNumber - 1);
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
  const range: IViewportRange = {
    start: { x: startColumn, y: bufferLineNumber },
    end: { x: startColumn + text.length - 1, y: bufferLineNumber },
  };
  return {
    range,
    text,
    activate,
  };
}

/**
 * Reads `index`'s logical line, joining wrapped continuations. xterm
 * stores wrapped lines as `isWrapped = true` on the continuation.
 */
function readLogicalLine(buf: Terminal["buffer"]["active"], index: number): string {
  // Walk backward to the start of the logical line.
  let start = index;
  while (start > 0 && buf.getLine(start)?.isWrapped) start--;
  let out = "";
  for (let i = start; i < buf.length; i++) {
    const ln: IBufferLine | undefined = buf.getLine(i);
    if (!ln) break;
    if (i > start && !ln.isWrapped) break;
    out += ln.translateToString(true);
  }
  return out;
}
```

- [ ] **Step 2: Verify it typechecks against the xterm types**

Run: `pnpm build`
Expected: build succeeds. If `ILinkProvider` / `IViewportRange` import errors fire, the xterm version may export them under a different name — open `node_modules/@xterm/xterm/typings/xterm.d.ts` and adjust the imports.

- [ ] **Step 3: Commit**

```bash
git add src/modules/terminal/lib/fileLinkProvider.ts
git commit -m "feat(terminal): xterm link provider for file paths"
```

---

## Task A6: Register the link provider in the renderer pool

**Files:**
- Modify: `src/modules/terminal/lib/rendererPool.ts:114-160`

- [ ] **Step 1: Wire the provider into `createSlot`**

In `src/modules/terminal/lib/rendererPool.ts`, add the new import near the existing addon imports (line 5-10):

```ts
import { createFileLinkProvider, fileExistenceCache } from "./fileLinkProvider";
```

Then inside `createSlot()` (around line 122), replace the `WebLinksAddon` load with the existing one *plus* the new provider, **and store the new provider's disposer on the slot** so we can clean up:

Find:

```ts
  term.loadAddon(
    new WebLinksAddon((_e, uri) => openUrl(uri).catch(console.error)),
  );
```

Replace with:

```ts
  term.loadAddon(
    new WebLinksAddon((_e, uri) => openUrl(uri).catch(console.error)),
  );

  const fileLinkDisposer = term.registerLinkProvider(
    createFileLinkProvider(term, {
      getCwd: () => {
        const leafId = slot.currentLeafId;
        if (leafId === null) return null;
        return adapter?.getCwd(leafId) ?? null;
      },
      onClick: (absPath, line, col) => {
        const leafId = slot.currentLeafId;
        if (leafId === null) return;
        void adapter?.openFile(leafId, absPath, line, col).then((ok) => {
          if (!ok) fileExistenceCache.invalidate(absPath);
        });
      },
      onMissing: (absPath) => fileExistenceCache.invalidate(absPath),
    }),
  );
```

The variable `fileLinkDisposer` is intentionally unused for now — xterm will dispose it when the terminal is disposed. (If you want lifecycle to be precise, push it into `slot.oscDisposers`; that array is already cleaned up at slot release and on terminal teardown.)

To make this clean, push the disposer into `slot.oscDisposers` *after* `slot` is constructed. Find the line that creates the slot object literal (around line 132) — after that, add:

```ts
  slot.oscDisposers.push(() => fileLinkDisposer.dispose());
```

(Note: the `createSlot` function returns `slot`; you'll need to register the provider *after* `slot` is defined so the `getCwd`/`onClick` closures can read `slot.currentLeafId`. If the order in your edited file would require referencing `slot` before declaration, restructure: declare `let slot: Slot;` early, build `slot` literal, then register the provider, then `slots.push(slot)`.)

A working ordering for `createSlot`:

```ts
function createSlot(): Slot {
  const term = new Terminal(termOptions());
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  const serializeAddon = new SerializeAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(searchAddon);
  term.loadAddon(serializeAddon);
  term.loadAddon(
    new WebLinksAddon((_e, uri) => openUrl(uri).catch(console.error)),
  );

  const host = document.createElement("div");
  host.style.cssText = "width:100%;height:100%;";
  host.setAttribute("data-terax-slot", String(slots.length));
  getRecycler().appendChild(host);
  term.open(host);

  const slot: Slot = {
    id: slots.length,
    term,
    fitAddon,
    searchAddon,
    serializeAddon,
    host,
    webglAddon: null,
    webglCanvases: [],
    currentLeafId: null,
    oscDisposers: [],
    observer: null,
    fitTimer: null,
    ptyTimer: null,
    unhideRaf: null,
    lastCols: term.cols,
    lastRows: term.rows,
    lastW: 0,
    lastH: 0,
    lastUsedAt: 0,
  };

  const fileLinkDisposer = term.registerLinkProvider(
    createFileLinkProvider(term, {
      getCwd: () => {
        const leafId = slot.currentLeafId;
        if (leafId === null) return null;
        return adapter?.getCwd(leafId) ?? null;
      },
      onClick: (absPath, line, col) => {
        const leafId = slot.currentLeafId;
        if (leafId === null) return;
        void adapter?.openFile(leafId, absPath, line, col).then((ok) => {
          if (!ok) fileExistenceCache.invalidate(absPath);
        });
      },
      onMissing: (absPath) => fileExistenceCache.invalidate(absPath),
    }),
  );
  slot.oscDisposers.push(() => fileLinkDisposer.dispose());

  attachWebgl(slot);
  // ... existing key/data handlers unchanged ...
```

(Keep the existing `attachWebgl`, `term.attachCustomKeyEventHandler`, `term.onData`, `slots.push(slot)` blocks exactly as they were.)

- [ ] **Step 2: Verify the project builds**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/modules/terminal/lib/rendererPool.ts
git commit -m "feat(terminal): register file-link provider on each xterm slot"
```

---

## Task A7: Extend `openFileTab` with a `selection` parameter

**Files:**
- Modify: `src/modules/tabs/lib/useTabs.ts:30-42, 205-276`

- [ ] **Step 1: Extend `EditorTab` with a one-shot `pendingSelection` field**

In `src/modules/tabs/lib/useTabs.ts`, change the `EditorTab` type (around line 30):

```ts
export type EditorTab = {
  id: number;
  kind: "editor";
  title: string;
  path: string;
  dirty: boolean;
  /**
   * True while the tab is in the transient "preview" state — opened by a
   * single-click in the explorer and not yet pinned by the user. A preview tab
   * is replaced by the next single-click rather than accumulating.
   */
  preview: boolean;
  /**
   * One-shot scroll/cursor target consumed by EditorPane on the next render.
   * Set when opened from a terminal-link click; cleared as soon as the editor
   * applies it. Coordinates are 1-based (matching compiler output).
   */
  pendingSelection?: { line: number; col?: number };
};
```

- [ ] **Step 2: Add an optional `selection` parameter to `openFileTab`**

Replace the `openFileTab = useCallback(...)` definition starting at line 205 with:

```ts
  const openFileTab = useCallback(
    (
      path: string,
      pin = true,
      selection?: { line: number; col?: number },
    ) => {
      let targetId: number | null = null;
      setTabs((curr) => {
        if (pin) {
          const existing = curr.find(
            (t) => t.kind === "editor" && t.path === path,
          );
          if (existing) {
            targetId = existing.id;
            return curr.map((t) =>
              t.id === existing.id
                ? {
                    ...t,
                    preview: false,
                    ...(selection
                      ? { pendingSelection: selection }
                      : {}),
                  }
                : t,
            );
          }
          const id = nextIdRef.current++;
          targetId = id;
          return [
            ...curr,
            {
              id,
              kind: "editor",
              title: basename(path),
              path,
              dirty: false,
              preview: false,
              ...(selection ? { pendingSelection: selection } : {}),
            } satisfies EditorTab,
          ];
        }
        const persistent = curr.find(
          (t) => t.kind === "editor" && t.path === path && !(t as EditorTab).preview,
        );
        if (persistent) {
          targetId = persistent.id;
          return selection
            ? curr.map((t) =>
                t.id === persistent.id
                  ? { ...t, pendingSelection: selection }
                  : t,
              )
            : curr;
        }
        const existingPreview = curr.find(
          (t) => t.kind === "editor" && t.path === path && (t as EditorTab).preview,
        );
        if (existingPreview) {
          targetId = existingPreview.id;
          return selection
            ? curr.map((t) =>
                t.id === existingPreview.id
                  ? { ...t, pendingSelection: selection }
                  : t,
              )
            : curr;
        }
        const previewIdx = curr.findIndex(
          (t) => t.kind === "editor" && (t as EditorTab).preview,
        );
        const id = nextIdRef.current++;
        targetId = id;
        const tab: EditorTab = {
          id,
          kind: "editor",
          title: basename(path),
          path,
          dirty: false,
          preview: true,
          ...(selection ? { pendingSelection: selection } : {}),
        };
        if (previewIdx === -1) return [...curr, tab];
        const next = [...curr];
        next[previewIdx] = tab;
        return next;
      });
      if (targetId !== null) setActiveId(targetId);
      return targetId as number | null;
    },
    [],
  );
```

- [ ] **Step 3: Add a `clearPendingSelection` helper**

Below the `pinTab` callback (around line 282), add:

```ts
  const clearPendingSelection = useCallback((id: number) => {
    setTabs((curr) =>
      curr.map((t) =>
        t.id === id && t.kind === "editor"
          ? { ...t, pendingSelection: undefined }
          : t,
      ),
    );
  }, []);
```

Then add `clearPendingSelection,` to the returned object at the bottom of `useTabs` (the same place `openFileTab,` and `pinTab,` are listed near line 782).

- [ ] **Step 4: Verify the project builds**

Run: `pnpm build`
Expected: build succeeds. (Existing callers of `openFileTab(path)` and `openFileTab(path, false)` keep working — the new arg is optional.)

- [ ] **Step 5: Commit**

```bash
git add src/modules/tabs/lib/useTabs.ts
git commit -m "feat(tabs): one-shot pendingSelection on openFileTab"
```

---

## Task A8: Consume `pendingSelection` in `EditorPane`

**Files:**
- Modify: `src/modules/editor/EditorPane.tsx:50-55, 215-265`
- Modify: `src/modules/editor/EditorStack.tsx` (props plumbing — caller of `EditorPane`)

- [ ] **Step 1: Add `pendingSelection` + `onSelectionApplied` props to `EditorPane`**

In `src/modules/editor/EditorPane.tsx`, change the `Props` type (around line 50):

```ts
type Props = {
  path: string;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
  onClose?: () => void;
  /**
   * One-shot scroll/cursor target. The pane dispatches a CodeMirror transaction
   * to move the selection there and scroll it into view, then calls
   * `onSelectionApplied` to clear it from the tab store.
   */
  pendingSelection?: { line: number; col?: number };
  onSelectionApplied?: () => void;
};
```

Change the function signature to destructure the new props:

```tsx
export const EditorPane = forwardRef<EditorPaneHandle, Props>(
  function EditorPane(
    { path, onDirtyChange, onSaved, onClose, pendingSelection, onSelectionApplied },
    ref,
  ) {
```

- [ ] **Step 2: Add a CodeMirror effect that applies the selection**

In `src/modules/editor/EditorPane.tsx`, immediately after the language-resolve effect (after the `useEffect` block that ends around line 215, *before* `useImperativeHandle`), add:

```tsx
    useEffect(() => {
      if (!pendingSelection) return;
      if (doc.status !== "ready" && doc.status !== "saving") return;
      const view = cmRef.current?.view;
      if (!view) return;

      const { line, col } = pendingSelection;
      const totalLines = view.state.doc.lines;
      const targetLine = Math.max(1, Math.min(line, totalLines));
      const lineInfo = view.state.doc.line(targetLine);
      const offset =
        col !== undefined
          ? Math.max(lineInfo.from, Math.min(lineInfo.to, lineInfo.from + col - 1))
          : lineInfo.from;

      // Defer one microtask so CodeMirror has flushed any prior doc-load
      // transactions. Without this, scrollIntoView can no-op on the first paint.
      Promise.resolve().then(() => {
        const v = cmRef.current?.view;
        if (!v) return;
        v.dispatch({
          selection: { anchor: offset, head: offset },
          scrollIntoView: true,
        });
        v.focus();
        onSelectionApplied?.();
      });
    }, [pendingSelection, doc.status, onSelectionApplied]);
```

Note: `doc.status` from `useDocument` exposes the loading/ready states. We gate on `ready`/`saving` so we don't try to dispatch before the document content has loaded.

- [ ] **Step 3: Plumb props through `EditorStack.tsx`**

Open `src/modules/editor/EditorStack.tsx` and locate where it renders `<EditorPane ... />` and where it consumes the tabs list. Add a prop on the stack that exposes `clearPendingSelection` (from `useTabs`), and pass each tab's `pendingSelection` plus a per-tab `onSelectionApplied` callback into `EditorPane`.

If `EditorStack` doesn't already receive the tab object, change its props to accept the full `EditorTab` (or at least `pendingSelection` and `onSelectionApplied`). The wiring lives wherever `EditorStack` is rendered — typically `src/app/App.tsx` around the editor-pane mount.

A minimal change inside `EditorStack.tsx`:

```tsx
<EditorPane
  ref={editorPaneRef}
  path={tab.path}
  pendingSelection={tab.pendingSelection}
  onSelectionApplied={() => onSelectionApplied?.(tab.id)}
  // ... existing props (onDirtyChange, onSaved, onClose) unchanged ...
/>
```

And add `onSelectionApplied?: (tabId: number) => void;` to `EditorStack`'s Props.

- [ ] **Step 4: Wire `clearPendingSelection` from `App.tsx`**

In `src/app/App.tsx`, find the `useTabs()` destructure (around line 155 where `openFileTab` is destructured) and add `clearPendingSelection` to it. Then pass it down to the `<EditorStack onSelectionApplied={clearPendingSelection} />` mount.

- [ ] **Step 5: Verify the project builds**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/modules/editor/EditorPane.tsx src/modules/editor/EditorStack.tsx src/app/App.tsx
git commit -m "feat(editor): apply pendingSelection on tab open"
```

---

## Task A9: Wire `openFile` from `App.tsx` to `openFileTab`

**Files:**
- Modify: `src/app/App.tsx` (around the `useTabs` destructure and a fresh effect)
- Modify: `src/modules/terminal/lib/useTerminalSession.ts` (verify the `setTerminalOpenFileHandler` export is reachable)

- [ ] **Step 1: Register the handler from `App.tsx`**

In `src/app/App.tsx`, near the top imports add:

```tsx
import { setTerminalOpenFileHandler } from "@/modules/terminal/lib/useTerminalSession";
```

Then, *inside the App component*, after `openFileTab` is in scope (after the `useTabs(...)` destructure on line 155), add this effect:

```tsx
  useEffect(() => {
    setTerminalOpenFileHandler(async (_leafId, path, line, col) => {
      const id = openFileTab(
        path,
        false, // preview slot — VSCode-style
        line !== undefined ? { line, col } : undefined,
      );
      return id !== null;
    });
    return () => {
      setTerminalOpenFileHandler(async () => false);
    };
  }, [openFileTab]);
```

- [ ] **Step 2: Verify the project builds**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Smoke test**

Run: `pnpm tauri dev`

In the terminal that opens, run:

```bash
echo "see src/app/App.tsx:155 for context"
ls README.md
```

Verify:
1. `src/app/App.tsx:155` appears underlined (after a brief existence-probe delay).
2. Clicking it opens `App.tsx` as a *preview* tab and scrolls to line 155.
3. `README.md` is underlined and clicking opens it.
4. A non-existent path printed to the terminal (e.g. `echo "see fake/missing.ts:10"`) is **not** underlined.

- [ ] **Step 4: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat(terminal): wire link clicks to editor tabs with line jump"
```

---

# Feature B — Local Whisper transcription

## Task B1: Add `@huggingface/transformers` dependency

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Install the package**

Run: `pnpm add @huggingface/transformers`
Expected: dependency added; lockfile updated.

- [ ] **Step 2: Sanity-check the install**

Run: `pnpm build`
Expected: build succeeds. (We haven't imported it yet, so this only verifies the dependency resolves cleanly.)

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): add @huggingface/transformers for local whisper"
```

---

## Task B2: Extend preferences schema for voice provider

**Files:**
- Modify: `src/modules/settings/store.ts:49-85, 124, 140-160, 192-287, 420-470, 478-540`

This is mechanical: each new preference needs (a) a `Preferences` type field, (b) a `DEFAULT_PREFERENCES` value, (c) a `KEY_*` constant, (d) a `loadPreferences` entry, (e) a setter, (f) an `onPreferencesChange` mapping. Follow the pattern used by every other preference in the file.

- [ ] **Step 1: Add the type fields**

In `src/modules/settings/store.ts`, find the `Preferences` type (around line 49) and add at the bottom of it (before the closing `};` on line 85):

```ts
  voiceProvider: "openai" | "local";
  localWhisperModel: string;
  localWhisperLanguage: string;
```

Also add a `WHISPER_MODELS` constant near the existing `EDITOR_THEMES` constant (around line 21):

```ts
export const WHISPER_MODELS = [
  { id: "onnx-community/whisper-tiny.en", label: "tiny.en", sizeMB: 75, multilingual: false },
  { id: "onnx-community/whisper-base.en", label: "base.en", sizeMB: 140, multilingual: false },
  { id: "onnx-community/whisper-base", label: "base", sizeMB: 140, multilingual: true },
  { id: "onnx-community/whisper-small.en", label: "small.en", sizeMB: 460, multilingual: false },
  { id: "onnx-community/whisper-small", label: "small", sizeMB: 460, multilingual: true },
] as const;

export type WhisperModelId = (typeof WHISPER_MODELS)[number]["id"];
```

- [ ] **Step 2: Add the storage key constants**

Add near the other `const KEY_*` declarations (around line 122):

```ts
const KEY_VOICE_PROVIDER = "voiceProvider";
const KEY_LOCAL_WHISPER_MODEL = "localWhisperModel";
const KEY_LOCAL_WHISPER_LANGUAGE = "localWhisperLanguage";
```

- [ ] **Step 3: Add the defaults**

In `DEFAULT_PREFERENCES` (around line 140), add:

```ts
  voiceProvider: "local",
  localWhisperModel: "onnx-community/whisper-base",
  localWhisperLanguage: "auto",
```

- [ ] **Step 4: Add the loaders**

In `loadPreferences` (around line 192), add inside the returned object (you'll see it has `theme`, `themeId`, etc. — add at the bottom alongside `shortcuts`):

```ts
    voiceProvider:
      get<"openai" | "local">(KEY_VOICE_PROVIDER) ??
      DEFAULT_PREFERENCES.voiceProvider,
    localWhisperModel:
      get<string>(KEY_LOCAL_WHISPER_MODEL) ??
      DEFAULT_PREFERENCES.localWhisperModel,
    localWhisperLanguage:
      get<string>(KEY_LOCAL_WHISPER_LANGUAGE) ??
      DEFAULT_PREFERENCES.localWhisperLanguage,
```

- [ ] **Step 5: Add the setters**

Below the existing setters (after `setZoomLevel`, around line 460), add:

```ts
export async function setVoiceProvider(value: "openai" | "local"): Promise<void> {
  await writePref(KEY_VOICE_PROVIDER, value);
}

export async function setLocalWhisperModel(value: string): Promise<void> {
  await writePref(KEY_LOCAL_WHISPER_MODEL, value);
}

export async function setLocalWhisperLanguage(value: string): Promise<void> {
  await writePref(KEY_LOCAL_WHISPER_LANGUAGE, value);
}
```

- [ ] **Step 6: Wire the change-listener map**

In `onPreferencesChange` (around line 478), inside the `map` object literal, add entries:

```ts
    [KEY_VOICE_PROVIDER]: "voiceProvider",
    [KEY_LOCAL_WHISPER_MODEL]: "localWhisperModel",
    [KEY_LOCAL_WHISPER_LANGUAGE]: "localWhisperLanguage",
```

- [ ] **Step 7: Verify the build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/modules/settings/store.ts
git commit -m "feat(prefs): voice provider + local whisper model settings"
```

---

## Task B3: Audio decode / downmix / resample helpers

**Files:**
- Create: `src/modules/ai/lib/audio.ts`
- Create: `src/modules/ai/lib/audio.test.ts`

The model expects mono Float32 PCM at 16 kHz. MediaRecorder gives us WebM/Opus (or similar) at the device's native sample rate — usually 48 kHz. We decode with the WebAudio `OfflineAudioContext`, downmix channels by averaging, and resample by passing a 16 kHz target rate.

- [ ] **Step 1: Write the failing test**

Create `src/modules/ai/lib/audio.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { blobToMonoPcm16k, downmixToMono, TARGET_SAMPLE_RATE } from "./audio";

describe("downmixToMono", () => {
  it("returns the single channel unchanged for mono input", () => {
    const ch = new Float32Array([0.1, 0.2, 0.3]);
    expect(downmixToMono([ch])).toEqual(ch);
  });

  it("averages channels for stereo input", () => {
    const l = new Float32Array([0.0, 0.5, 1.0]);
    const r = new Float32Array([1.0, 0.5, 0.0]);
    expect(Array.from(downmixToMono([l, r]))).toEqual([0.5, 0.5, 0.5]);
  });

  it("averages all three channels for surround input", () => {
    const a = new Float32Array([0, 3]);
    const b = new Float32Array([0, 3]);
    const c = new Float32Array([0, 3]);
    expect(Array.from(downmixToMono([a, b, c]))).toEqual([0, 3]);
  });
});

describe("blobToMonoPcm16k", () => {
  it("uses OfflineAudioContext at the target sample rate", async () => {
    // Mock an AudioBuffer + OfflineAudioContext just enough to verify
    // we ask for 16 kHz mono and return its rendered channel data.
    const numFrames = 48_000;
    const stereoBuffer = {
      numberOfChannels: 1,
      length: numFrames,
      sampleRate: 48_000,
      duration: 1,
      getChannelData: () => new Float32Array(numFrames).fill(0.42),
    };
    const renderedFrames = 16_000;
    const renderedBuffer = {
      numberOfChannels: 1,
      length: renderedFrames,
      sampleRate: 16_000,
      duration: 1,
      getChannelData: () => new Float32Array(renderedFrames).fill(0.42),
    };
    const ctorCalls: Array<{ ch: number; len: number; rate: number }> = [];
    class FakeOfflineCtx {
      destination = {};
      constructor(ch: number, len: number, rate: number) {
        ctorCalls.push({ ch, len, rate });
      }
      createBufferSource() {
        return {
          buffer: null as null | unknown,
          connect: () => {},
          start: () => {},
        };
      }
      decodeAudioData() {
        return Promise.resolve(stereoBuffer);
      }
      startRendering() {
        return Promise.resolve(renderedBuffer);
      }
    }
    vi.stubGlobal("OfflineAudioContext", FakeOfflineCtx);

    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const out = await blobToMonoPcm16k(blob);
    expect(out).toBeInstanceOf(Float32Array);
    expect(out.length).toBe(renderedFrames);
    expect(TARGET_SAMPLE_RATE).toBe(16_000);
    // Last constructor call is the render context (16k); decode context
    // is the first call. Both must use mono.
    expect(ctorCalls[ctorCalls.length - 1].rate).toBe(16_000);
    expect(ctorCalls[ctorCalls.length - 1].ch).toBe(1);

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/modules/ai/lib/audio.test.ts`
Expected: FAIL — `Cannot find module './audio'`.

- [ ] **Step 3: Implement the helpers**

Create `src/modules/ai/lib/audio.ts`:

```ts
/** Whisper's expected sample rate. The model is trained on 16 kHz mono. */
export const TARGET_SAMPLE_RATE = 16_000;

/**
 * Average all channels into a single mono Float32Array. For mono input
 * the channel is returned unchanged. Surround layouts are flattened to
 * a centered mix, which is acceptable for speech transcription.
 */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const len = channels[0].length;
  const out = new Float32Array(len);
  const n = channels.length;
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (let c = 0; c < n; c++) s += channels[c][i];
    out[i] = s / n;
  }
  return out;
}

/**
 * Decode a MediaRecorder blob (WebM/Opus, OGG, MP4, etc.) to a mono
 * Float32 PCM array at TARGET_SAMPLE_RATE. Two OfflineAudioContexts:
 * one for decode (native rate), one for high-quality resample (target rate).
 */
export async function blobToMonoPcm16k(blob: Blob): Promise<Float32Array> {
  const ab = await blob.arrayBuffer();

  // A short-lived OfflineAudioContext for decoding. The frame count and
  // sample rate are irrelevant for decodeAudioData — they're just required
  // by the constructor. We use the target rate so the WebAudio
  // implementation has a clean default if it auto-resamples.
  const decodeCtx = new OfflineAudioContext(1, 1, TARGET_SAMPLE_RATE);
  const decoded = await decodeCtx.decodeAudioData(ab);

  // Collect the decoded channels into an array of Float32Arrays.
  const decodedChannels: Float32Array[] = [];
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    decodedChannels.push(decoded.getChannelData(c));
  }
  const mono = downmixToMono(decodedChannels);

  // If already at the right rate, skip the render pass.
  if (decoded.sampleRate === TARGET_SAMPLE_RATE) return mono;

  const frames = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);
  const renderCtx = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE);
  const src = renderCtx.createBufferSource();
  // Reconstruct a single-channel buffer at the decoded rate so the
  // OfflineAudioContext's resampler does the rate conversion.
  const buf = new AudioBuffer({
    length: mono.length,
    numberOfChannels: 1,
    sampleRate: decoded.sampleRate,
  });
  buf.copyToChannel(mono, 0);
  src.buffer = buf;
  src.connect(renderCtx.destination);
  src.start(0);
  const rendered = await renderCtx.startRendering();
  return rendered.getChannelData(0);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/modules/ai/lib/audio.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ai/lib/audio.ts src/modules/ai/lib/audio.test.ts
git commit -m "feat(ai): audio decode + downmix + 16k resample helpers"
```

---

## Task B4: Whisper Web Worker

**Files:**
- Create: `src/modules/ai/workers/whisperWorker.ts`

The worker owns the transformers.js pipeline singleton and a tiny message protocol. It runs in a separate thread so transcription doesn't freeze the UI.

- [ ] **Step 1: Implement the worker**

Create `src/modules/ai/workers/whisperWorker.ts`:

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Web Worker hosting a singleton @huggingface/transformers Whisper pipeline.
 * Main-thread protocol:
 *   In:  { kind: "load", model }
 *        { kind: "transcribe", pcm: Float32Array, language? }
 *        { kind: "unload" }
 *   Out: { kind: "progress", file, loaded, total }
 *        { kind: "ready", model, backend: "gpu" | "cpu" }
 *        { kind: "result", text }
 *        { kind: "error", message }
 *
 * The pipeline is created lazily on `load` and reused across transcriptions.
 * Switching models triggers a fresh load. Posting a transcribe before the
 * pipeline is ready will await the in-flight load (load is idempotent).
 */

import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

// Allow the library to fetch ONNX builds from the HF Hub.
env.allowRemoteModels = true;
env.allowLocalModels = false;

type InMessage =
  | { kind: "load"; model: string }
  | { kind: "transcribe"; pcm: Float32Array; language?: string }
  | { kind: "unload" };

type OutMessage =
  | { kind: "progress"; file: string; loaded: number; total: number }
  | { kind: "ready"; model: string; backend: "gpu" | "cpu" }
  | { kind: "result"; text: string }
  | { kind: "error"; message: string };

let currentModel: string | null = null;
let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loadingPromise: Promise<void> | null = null;
let loadedBackend: "gpu" | "cpu" = "cpu";

function post(msg: OutMessage, transfer?: Transferable[]) {
  if (transfer) (self as any).postMessage(msg, transfer);
  else (self as any).postMessage(msg);
}

async function ensureLoaded(model: string): Promise<void> {
  if (asr && currentModel === model) return;
  if (loadingPromise && currentModel === model) return loadingPromise;

  asr = null;
  currentModel = model;

  loadingPromise = (async () => {
    // transformers.js will try WebGPU first when the device is "webgpu";
    // it falls back to WASM on platforms (e.g. WebKitGTK on Linux) without
    // WebGPU support. We attempt webgpu first then explicitly fall back.
    try {
      asr = (await pipeline("automatic-speech-recognition", model, {
        device: "webgpu",
        progress_callback: (p: any) => {
          if (p?.status === "progress") {
            post({
              kind: "progress",
              file: p.file ?? "",
              loaded: p.loaded ?? 0,
              total: p.total ?? 0,
            });
          }
        },
      })) as AutomaticSpeechRecognitionPipeline;
      loadedBackend = "gpu";
    } catch (e) {
      console.warn("[whisper] WebGPU init failed, falling back to WASM:", e);
      asr = (await pipeline("automatic-speech-recognition", model, {
        progress_callback: (p: any) => {
          if (p?.status === "progress") {
            post({
              kind: "progress",
              file: p.file ?? "",
              loaded: p.loaded ?? 0,
              total: p.total ?? 0,
            });
          }
        },
      })) as AutomaticSpeechRecognitionPipeline;
      loadedBackend = "cpu";
    }
    post({ kind: "ready", model, backend: loadedBackend });
  })();

  try {
    await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

self.onmessage = async (ev: MessageEvent<InMessage>) => {
  const msg = ev.data;
  try {
    if (msg.kind === "load") {
      await ensureLoaded(msg.model);
      return;
    }
    if (msg.kind === "unload") {
      asr = null;
      currentModel = null;
      return;
    }
    if (msg.kind === "transcribe") {
      if (!asr || !currentModel) {
        post({ kind: "error", message: "Model not loaded" });
        return;
      }
      const result: any = await asr(msg.pcm, {
        language: msg.language && msg.language !== "auto" ? msg.language : undefined,
        // 30 s windows are the standard Whisper preprocessing chunk.
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      const text = typeof result?.text === "string" ? result.text : "";
      post({ kind: "result", text });
      return;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    post({ kind: "error", message });
  }
};
```

- [ ] **Step 2: Verify the project builds with the worker**

Run: `pnpm build`
Expected: build succeeds. Vite's worker support requires the worker file to be referenced via `new Worker(new URL(...), { type: "module" })` from a regular module; we'll do that in the next task. The worker's TypeScript should compile in isolation as a module.

- [ ] **Step 3: Commit**

```bash
git add src/modules/ai/workers/whisperWorker.ts
git commit -m "feat(ai): Whisper worker — transformers.js with WebGPU/WASM fallback"
```

---

## Task B5: Transcriber interface + factory

**Files:**
- Create: `src/modules/ai/lib/transcribers/index.ts`
- Create: `src/modules/ai/lib/transcribers/openai.ts`
- Create: `src/modules/ai/lib/transcribers/local.ts`

- [ ] **Step 1: Define the interface**

Create `src/modules/ai/lib/transcribers/index.ts`:

```ts
import { createLocalTranscriber, type LocalTranscriber } from "./local";
import { createOpenAITranscriber } from "./openai";

export type TranscriberState =
  | { kind: "idle" }
  | { kind: "loading"; file?: string; loaded: number; total: number }
  | { kind: "loaded"; backend: "gpu" | "cpu" }
  | { kind: "error"; message: string };

export interface Transcriber {
  /** Whether the user can press the mic button right now. */
  ready(): boolean;
  /** Optional explanation when ready() is false. */
  unavailableReason(): string | null;
  /** Begin pre-loading any expensive setup (model download/warmup). No-op for OpenAI. */
  preload(): void;
  /** Run transcription. May await preload internally. */
  transcribe(blob: Blob): Promise<string>;
  /** Subscribe to state changes (idle/loading/loaded/error). */
  subscribe(listener: (state: TranscriberState) => void): () => void;
  /** Snapshot of current state. */
  getState(): TranscriberState;
  /** Free any owned resources (model worker, etc.). */
  unload(): void;
  /** True for the local provider — surfaces UI affordances like Unload button. */
  readonly isLocal: boolean;
}

export type TranscriberSelection =
  | { kind: "openai"; apiKey: string | null }
  | { kind: "local"; model: string; language: string };

/**
 * Returns a transcriber for the requested selection, or null when the
 * selection is currently unusable (e.g. OpenAI without a key). UI may
 * still call the returned Transcriber's `ready()` to render an inline
 * "configure" affordance.
 */
export function createTranscriber(sel: TranscriberSelection): Transcriber {
  if (sel.kind === "openai") {
    return createOpenAITranscriber({ apiKey: sel.apiKey });
  }
  return createLocalTranscriber({ model: sel.model, language: sel.language });
}

export type { LocalTranscriber };
```

- [ ] **Step 2: Implement the OpenAI transcriber**

Create `src/modules/ai/lib/transcribers/openai.ts`:

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { experimental_transcribe as transcribe } from "ai";
import type { Transcriber, TranscriberState } from "./index";

export function createOpenAITranscriber(opts: {
  apiKey: string | null;
}): Transcriber {
  const listeners = new Set<(s: TranscriberState) => void>();
  let state: TranscriberState = opts.apiKey
    ? { kind: "loaded", backend: "cpu" } // "loaded" means no setup needed
    : { kind: "error", message: "OpenAI API key not configured" };

  function setState(next: TranscriberState) {
    state = next;
    for (const l of listeners) l(state);
  }

  return {
    isLocal: false,
    ready: () => state.kind === "loaded",
    unavailableReason: () =>
      state.kind === "error" ? state.message : null,
    preload: () => {},
    async transcribe(blob) {
      if (!opts.apiKey) throw new Error("OpenAI API key not configured");
      setState({ kind: "loading", loaded: 0, total: 0 });
      try {
        const openai = createOpenAI({ apiKey: opts.apiKey });
        const buf = new Uint8Array(await blob.arrayBuffer());
        const { text } = await transcribe({
          model: openai.transcription("whisper-1"),
          audio: buf,
        });
        setState({ kind: "loaded", backend: "cpu" });
        return text;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setState({ kind: "error", message });
        throw e;
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    unload: () => {},
  };
}
```

- [ ] **Step 3: Implement the local transcriber**

Create `src/modules/ai/lib/transcribers/local.ts`:

```ts
import { blobToMonoPcm16k } from "../audio";
import type { Transcriber, TranscriberState } from "./index";

export interface LocalTranscriber extends Transcriber {
  /** Force-reload the worker (used after model change). */
  reload(): void;
}

type WorkerIn =
  | { kind: "load"; model: string }
  | { kind: "transcribe"; pcm: Float32Array; language?: string }
  | { kind: "unload" };

type WorkerOut =
  | { kind: "progress"; file: string; loaded: number; total: number }
  | { kind: "ready"; model: string; backend: "gpu" | "cpu" }
  | { kind: "result"; text: string }
  | { kind: "error"; message: string };

export function createLocalTranscriber(opts: {
  model: string;
  language: string;
}): LocalTranscriber {
  const listeners = new Set<(s: TranscriberState) => void>();
  let state: TranscriberState = { kind: "idle" };
  let worker: Worker | null = null;
  let readyResolve: (() => void) | null = null;
  let readyPromise: Promise<void> | null = null;
  let pendingTranscribe:
    | { resolve: (text: string) => void; reject: (e: Error) => void }
    | null = null;

  function setState(next: TranscriberState) {
    state = next;
    for (const l of listeners) l(state);
  }

  function ensureWorker() {
    if (worker) return;
    worker = new Worker(
      new URL("../../workers/whisperWorker.ts", import.meta.url),
      { type: "module" },
    );
    readyPromise = new Promise<void>((resolve) => {
      readyResolve = resolve;
    });

    worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
      const m = ev.data;
      if (m.kind === "progress") {
        setState({
          kind: "loading",
          file: m.file,
          loaded: m.loaded,
          total: m.total,
        });
        return;
      }
      if (m.kind === "ready") {
        setState({ kind: "loaded", backend: m.backend });
        readyResolve?.();
        return;
      }
      if (m.kind === "result") {
        const p = pendingTranscribe;
        pendingTranscribe = null;
        p?.resolve(m.text);
        return;
      }
      if (m.kind === "error") {
        setState({ kind: "error", message: m.message });
        const p = pendingTranscribe;
        pendingTranscribe = null;
        p?.reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      setState({ kind: "error", message: String(e.message ?? e) });
      const p = pendingTranscribe;
      pendingTranscribe = null;
      p?.reject(new Error(e.message || "worker error"));
    };

    const msg: WorkerIn = { kind: "load", model: opts.model };
    worker.postMessage(msg);
    setState({ kind: "loading", loaded: 0, total: 0 });
  }

  return {
    isLocal: true,
    ready: () => true, // Local is always available; load happens lazily.
    unavailableReason: () => null,
    preload: () => ensureWorker(),
    async transcribe(blob) {
      ensureWorker();
      await readyPromise;
      const pcm = await blobToMonoPcm16k(blob);
      if (pcm.length < 16_000 * 0.2) {
        // Too short — saves a worker roundtrip on accidental taps.
        setState({ kind: "loaded", backend: "cpu" });
        return "";
      }

      return new Promise<string>((resolve, reject) => {
        pendingTranscribe = { resolve, reject };
        const msg: WorkerIn = {
          kind: "transcribe",
          pcm,
          language: opts.language,
        };
        worker!.postMessage(msg, [pcm.buffer]);
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    unload: () => {
      worker?.terminate();
      worker = null;
      readyResolve = null;
      readyPromise = null;
      setState({ kind: "idle" });
    },
    reload: () => {
      worker?.terminate();
      worker = null;
      readyResolve = null;
      readyPromise = null;
      setState({ kind: "idle" });
      ensureWorker();
    },
  };
}
```

- [ ] **Step 4: Verify the build**

Run: `pnpm build`
Expected: build succeeds. Vite will detect the `new Worker(new URL(...), { type: "module" })` pattern and emit the worker as a separate bundle.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ai/lib/transcribers
git commit -m "feat(ai): transcriber abstraction with OpenAI + local impls"
```

---

## Task B6: Refactor `useWhisperRecording` to use the abstraction

**Files:**
- Modify: `src/modules/ai/hooks/useWhisperRecording.ts` (full rewrite)

- [ ] **Step 1: Rewrite the hook**

Replace `src/modules/ai/hooks/useWhisperRecording.ts` with:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useChatStore } from "../store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  createTranscriber,
  type Transcriber,
  type TranscriberState,
} from "../lib/transcribers";

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

type RecordingState = "idle" | "recording" | "transcribing";

export function useWhisperRecording({
  onResult,
}: {
  onResult: (text: string) => void;
}) {
  const apiKey = useChatStore((s) => s.apiKeys.openai);
  const voiceProvider = usePreferencesStore((s) => s.voiceProvider);
  const localModel = usePreferencesStore((s) => s.localWhisperModel);
  const localLanguage = usePreferencesStore((s) => s.localWhisperLanguage);

  const [state, setState] = useState<RecordingState>("idle");
  const [transcriberState, setTranscriberState] = useState<TranscriberState>({
    kind: "idle",
  });

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const transcriberRef = useRef<Transcriber | null>(null);

  // Recreate the transcriber whenever the selection changes.
  useEffect(() => {
    transcriberRef.current?.unload();
    const t = createTranscriber(
      voiceProvider === "local"
        ? { kind: "local", model: localModel, language: localLanguage }
        : { kind: "openai", apiKey: apiKey ?? null },
    );
    transcriberRef.current = t;
    const unsub = t.subscribe(setTranscriberState);
    return () => {
      unsub();
      t.unload();
      if (transcriberRef.current === t) transcriberRef.current = null;
    };
  }, [voiceProvider, localModel, localLanguage, apiKey]);

  const supported =
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";

  const teardownStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  const start = useCallback(async () => {
    const t = transcriberRef.current;
    if (!supported || !t || state !== "idle") return;
    if (!t.ready()) return;

    // Kick off model preload in parallel with capturing audio.
    t.preload();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMime();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || "audio/webm",
        });
        chunksRef.current = [];
        teardownStream();
        if (blob.size === 0) {
          setState("idle");
          return;
        }
        setState("transcribing");
        try {
          const active = transcriberRef.current;
          if (!active) return;
          const text = await active.transcribe(blob);
          if (text.trim()) onResult(text.trim());
        } catch (e) {
          console.error("whisper.transcribe", e);
        } finally {
          setState("idle");
        }
      };
      recRef.current = rec;
      rec.start();
      setState("recording");
    } catch (e) {
      console.error("whisper.getUserMedia", e);
      teardownStream();
      setState("idle");
    }
  }, [onResult, state, supported]);

  useEffect(() => {
    return () => {
      recRef.current?.stop();
      teardownStream();
    };
  }, []);

  const provider = voiceProvider;
  const reasonUnavailable =
    transcriberRef.current?.unavailableReason() ?? null;

  return {
    state,
    recording: state === "recording",
    transcribing: state === "transcribing",
    start,
    stop,
    supported,
    /** Backwards-compat alias used by current UI code paths. */
    hasKey: provider === "openai" ? !!apiKey : true,
    canRecord:
      supported &&
      (transcriberRef.current?.ready() ?? false),
    reasonUnavailable,
    /** The transcriber's own state (loading model / loaded / error). */
    transcriberState,
    provider,
    isLocalLoading:
      provider === "local" && transcriberState.kind === "loading",
  };
}
```

- [ ] **Step 2: Verify the build**

Run: `pnpm build`
Expected: build succeeds. Existing callers (`composer.tsx`, `AiStatusBarControls.tsx`, `AiInputBar.tsx`) still see `state`, `recording`, `transcribing`, `start`, `stop`, `supported`, `hasKey` — all unchanged. New fields are additive.

- [ ] **Step 3: Commit**

```bash
git add src/modules/ai/hooks/useWhisperRecording.ts
git commit -m "feat(ai): provider-agnostic voice recording hook"
```

---

## Task B7: Update mic-button UI for new states

**Files:**
- Modify: `src/modules/ai/components/AiStatusBarControls.tsx:125-153`

- [ ] **Step 1: Extend the button's title/disabled logic**

In `src/modules/ai/components/AiStatusBarControls.tsx`, replace the mic-button block (lines 125-153) with:

```tsx
      {c.voice.supported && (
        <IconBtn
          title={
            c.voice.isLocalLoading
              ? `Downloading model… ${formatProgress(c.voice.transcriberState)}`
              : !c.voice.canRecord
                ? c.voice.reasonUnavailable ?? "Voice input unavailable"
                : c.voice.recording
                  ? "Stop & transcribe"
                  : c.voice.transcribing
                    ? "Transcribing…"
                    : "Voice input"
          }
          onClick={() =>
            c.voice.recording ? c.voice.stop() : void c.voice.start()
          }
          disabled={
            c.isBusy ||
            c.voice.transcribing ||
            (!c.voice.canRecord && !c.voice.isLocalLoading)
          }
          className={cn(
            c.voice.recording &&
              "bg-destructive/10 text-destructive hover:bg-destructive/15",
          )}
        >
          {c.voice.recording ? (
            <span className="size-2 animate-pulse rounded-full bg-destructive" />
          ) : c.voice.transcribing || c.voice.isLocalLoading ? (
            <Spinner className="size-3" />
          ) : (
            <HugeiconsIcon icon={Mic01Icon} size={13} strokeWidth={1.75} />
          )}
        </IconBtn>
      )}
```

- [ ] **Step 2: Add the progress formatter helper**

At the top of the same file (after imports), add:

```ts
function formatProgress(state: { loaded?: number; total?: number; kind: string }): string {
  if (state.kind !== "loading") return "";
  const total = state.total ?? 0;
  if (total <= 0) return "preparing…";
  const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(0)} MB`;
  return `${mb(state.loaded ?? 0)} / ${mb(total)}`;
}
```

- [ ] **Step 3: Verify the build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/modules/ai/components/AiStatusBarControls.tsx
git commit -m "feat(ai): mic button states for local model load + reason text"
```

---

## Task B8: Surface model-download progress in `AiInputBar`

**Files:**
- Modify: `src/modules/ai/components/AiInputBar.tsx:210-340`

- [ ] **Step 1: Extend the `voiceLabel` derivation**

In `src/modules/ai/components/AiInputBar.tsx`, find the `voiceLabel` definition (around line 210) and replace it with:

```ts
  const voiceLabel = c.voice.isLocalLoading
    ? (() => {
        const s = c.voice.transcriberState;
        if (s.kind !== "loading") return "Loading model…";
        const total = s.total ?? 0;
        if (total <= 0) return "Loading model…";
        const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(0)} MB`;
        return `Downloading model · ${mb(s.loaded ?? 0)} / ${mb(total)}`;
      })()
    : c.voice.recording
      ? "Recording…"
      : c.voice.transcribing
        ? "Transcribing…"
        : null;
```

The downstream JSX that renders `{voiceLabel && (...)}` does not change.

- [ ] **Step 2: Verify the build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/modules/ai/components/AiInputBar.tsx
git commit -m "feat(ai): show model-download progress in input bar"
```

---

## Task B9: Settings UI — Voice input section

**Files:**
- Find the AI section file in `src/settings/sections/` (e.g. `ModelsSection.tsx` or a sibling) and either add a new section file or extend the existing AI section.
- Create: `src/settings/sections/VoiceInputSection.tsx`

- [ ] **Step 1: Locate where sections register**

Run: `grep -rn "ModelsSection\|sections/" src/settings | head -30`
Identify the parent component that mounts sections (settings.html entry typically lives at `src/settings/`). Add `VoiceInputSection` to the same registration list.

- [ ] **Step 2: Create the section**

Create `src/settings/sections/VoiceInputSection.tsx`:

```tsx
import { useEffect, useState } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  WHISPER_MODELS,
  setVoiceProvider,
  setLocalWhisperModel,
  setLocalWhisperLanguage,
  type WhisperModelId,
} from "@/modules/settings/store";
import { useChatStore } from "@/modules/ai/store/chatStore";

export function VoiceInputSection() {
  const voiceProvider = usePreferencesStore((s) => s.voiceProvider);
  const localModel = usePreferencesStore((s) => s.localWhisperModel);
  const localLanguage = usePreferencesStore((s) => s.localWhisperLanguage);
  const openaiKey = useChatStore((s) => s.apiKeys.openai);

  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-sm font-semibold">Voice input</h2>
        <p className="text-xs text-muted-foreground">
          Transcribe speech to text in the composer. Choose a local model for
          offline use or OpenAI's hosted Whisper for the lowest setup cost.
        </p>
      </header>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="radio"
            name="voiceProvider"
            checked={voiceProvider === "local"}
            onChange={() => void setVoiceProvider("local")}
          />
          <span>Local (in-app)</span>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="radio"
            name="voiceProvider"
            checked={voiceProvider === "openai"}
            onChange={() => void setVoiceProvider("openai")}
          />
          <span>OpenAI cloud</span>
          {!openaiKey && voiceProvider === "openai" ? (
            <span className="text-amber-500">needs an OpenAI key</span>
          ) : null}
        </label>
      </div>

      {voiceProvider === "local" ? (
        <div className="space-y-3 pl-4">
          <label className="block text-xs">
            Model
            <select
              className="ml-2 rounded border border-border bg-card px-2 py-1 text-xs"
              value={localModel}
              onChange={(e) => void setLocalWhisperModel(e.target.value as WhisperModelId)}
            >
              {WHISPER_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} · {m.sizeMB} MB{m.multilingual ? "" : " · English only"}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs">
            Language
            <input
              className="ml-2 w-32 rounded border border-border bg-card px-2 py-1 text-xs"
              value={localLanguage}
              onChange={(e) => void setLocalWhisperLanguage(e.target.value)}
              placeholder="auto"
              title='ISO 639-1 code (e.g. "en", "de"). Use "auto" for detection. Ignored by .en models.'
            />
          </label>

          <p className="text-[11px] text-muted-foreground">
            The model downloads on first use and is cached by your browser.
          </p>
        </div>
      ) : (
        <p className="pl-4 text-xs text-muted-foreground">
          Uses the OpenAI API key configured in the AI section.
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Register the section**

Open the file you identified in Step 1 (the section registry) and add `VoiceInputSection` next to the existing sections. If the registry is a tab list, add a new tab entry pointing to `"voice"` and the section component.

- [ ] **Step 4: Verify the build**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/settings/sections/VoiceInputSection.tsx <registry file>
git commit -m "feat(settings): voice input section with provider + model selector"
```

---

## Task B10: Final smoke test (Feature B)

**Files:** none — manual verification.

- [ ] **Step 1: Run the app**

Run: `pnpm tauri dev`

- [ ] **Step 2: Default-provider voice input (no OpenAI key)**

1. Make sure no OpenAI API key is configured (clear it in settings if necessary).
2. Click the mic icon in the AI composer.
3. Confirm the icon shows a spinner and the input bar shows `Downloading model · X MB / Y MB` while the model downloads on first use.
4. Speak a short phrase.
5. Stop recording; confirm the transcribed text appears in the composer.

- [ ] **Step 3: Switch to OpenAI cloud**

1. In Settings → Voice input, switch provider to "OpenAI cloud".
2. Without a key configured, confirm the mic button is disabled with a tooltip explaining why.
3. Add an OpenAI API key, click the mic, record, and confirm transcription via the cloud API.

- [ ] **Step 4: Model switch / unload**

1. Switch back to Local, change the model from `base` to `tiny.en`.
2. Confirm the next recording triggers a fresh download.
3. (Optional smoke for the unload path, if you wired an Unload button in settings.)

- [ ] **Step 5: Commit if any smoke-test tweaks were needed**

```bash
git add -A
git commit -m "fix(ai): smoke-test adjustments to voice input"
```

(If no changes were needed, skip the commit.)

---

# Final tasks

## Task Z1: README copy update

**Files:**
- Modify: `README.md` (voice-input section)

- [ ] **Step 1: Update the README**

Find the section about voice input in `README.md`. Replace any wording that says voice input requires an OpenAI key with copy that mentions the default is local (in-browser) transcription with no key required, and that OpenAI cloud Whisper remains an option in Settings → Voice input. Mention the first-run model download.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: voice input now local by default"
```

## Task Z2: Final full smoke

**Files:** none — manual.

- [ ] **Step 1: Run the full app one more time**

Run: `pnpm tauri dev`

- [ ] **Step 2: Verify both features together**

1. In the terminal: `echo "see src/app/App.tsx:200"` — click it, confirm tab opens at line 200.
2. In the terminal: `echo "see nonexistent/path.ts"` — confirm no underline.
3. In the composer: click the mic, speak, confirm transcription.
4. Verify nothing else regressed: open existing files via the explorer, run a few terminal commands, switch tabs.

- [ ] **Step 3: Run the test suite**

Run: `pnpm test`
Expected: all tests pass (existing + new ones from A2, A3, B3).

- [ ] **Step 4: Run the typecheck + build**

Run: `pnpm build`
Expected: build succeeds.

---

## Self-Review Notes (filled in by plan author after writing)

**Spec coverage:** Every section of the spec maps to at least one task:
- Spec §1 Terminal links → Tasks A1–A9.
- Spec §2 Whisper architecture (worker + audio pipeline + transcriber + default model + lifecycle) → Tasks B1, B3, B4, B5, B6.
- Spec §2 Settings UI → Task B9.
- Spec §2 Mic button states → Tasks B7, B8.
- Spec §2 Preferences additions → Task B2.
- Spec §3 Error/edge cases — covered inline (matcher rejects, existence cache invalidation on click failure, decode failure handling in B3, model load failure surfacing via transcriberState in B6/B7).
- Spec §4 Out of scope — nothing in the plan adds those.
- Documentation follow-ups → Task Z1.

**Placeholder scan:** All steps include either runnable commands or full code. No TBDs, no "implement appropriate error handling" without showing what.

**Type consistency:** `Transcriber`, `TranscriberState`, and `LocalTranscriber` are consistent across Tasks B5, B6, B7, B8. The `SlotAdapter` extension in A4 matches its consumer in A6. `EditorTab.pendingSelection` in A7 matches the consumer in A8.

**Open risks:**
- `EditorStack.tsx` is referenced in A8 but its current shape isn't quoted — the engineer should grep for `<EditorPane` to find the exact prop-passing site. The intent is clear (thread `pendingSelection` and `onSelectionApplied` through).
- The xterm `ILinkProvider` API and `IViewportRange` import names depend on the installed xterm version; if names differ, the engineer should `grep "ILinkProvider" node_modules/@xterm/xterm/typings/`.
- transformers.js model IDs (`onnx-community/whisper-*`) exist as of writing but the engineer should verify by trying the first download. If 404s, switch to `Xenova/whisper-*` (the older but still-mirrored namespace).
