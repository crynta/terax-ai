# Session restoration: save and restore open tabs across restarts

**Date:** 2026-05-26
**Status:** Draft for implementation
**Issue:** [#497](https://github.com/crynta/terax-ai/issues/497)

Restore the user's open tabs (terminals, editors, markdown previews) when Terax relaunches, gated by a new "Restore previous session" toggle in **Settings → General**. Default ON.

---

## 1. Keying & storage

### Session key

Sessions are keyed by `<launchDir-or-"default">::<workspaceScopeKey>`. Examples:

- `/Users/kalle/xxx/terax-ai::local`
- `/srv/foo::wsl:Ubuntu`
- `default::local` (when no launch dir was passed)

Components:

- **Launch dir** from `getLaunchDir()` in `src/lib/launchDir.ts`. This is the CLI arg facility (`terax ~/projects/foo`); when absent (icon launch), the key falls back to the literal string `"default"`, which collapses all icon-launched windows of the same env into one shared session.
- **Workspace scope key** from `currentWorkspaceScopeKey()` in `src/modules/workspace/env.ts`. Returns `"local"` or `"wsl:<distro>"`.

Distinct launch dirs get distinct sessions — `terax ~/projects/foo` and `terax ~/projects/bar` keep separate tab sets. Same for local vs WSL environments.

### Storage

A new Tauri `LazyStore` file: `terax-sessions.json`. Kept separate from `terax-settings.json` so that wiping sessions doesn't touch prefs, and vice versa.

Top-level shape: `Record<sessionKey, SessionV1>`.

Pruning: on every `loadSession` call, entries with `updatedAt < now - 30d` are removed in the background before returning the requested key. Estimated size: ~1 KB per session × ~10 active sessions = ~10 KB. Pruning is defensive against accumulation over years.

### Workspace env transitions

Switching local ↔ WSL after launch (via `WorkspaceEnvSelector`) changes the `sessionKey` derivation. The persistence effect's deps include `sessionKey`, so the next debounced write goes to the new key. The old key keeps its last-written state — exactly the right behavior. We do **not** migrate state across envs; different envs have different filesystems and a saved CWD from local doesn't make sense in WSL.

---

## 2. Schema

```ts
type SessionV1 = {
  version: 1;
  updatedAt: number;          // ms epoch, drives pruning
  activeTabId: number | null; // serialized id; remapped on restore
  tabs: SerializedTab[];
};

type SerializedTab =
  | SerializedTerminalTab
  | SerializedEditorTab
  | SerializedMarkdownTab;

type SerializedTerminalTab = {
  kind: "terminal";
  id: number;
  title: string;
  cwd: string | null;
  paneTree: SerializedPaneNode;
  activeLeafId: number;
  private?: boolean;
};

type SerializedPaneNode =
  | { kind: "leaf"; id: number; cwd: string | null }
  | {
      kind: "split";
      id: number;
      dir: "row" | "col";
      children: SerializedPaneNode[];
      /** Optional per-child sizes (percent, sums to ~100). Omitted by older
       *  saves; restored splits without sizes come back equal-share. */
      sizes?: number[];
    };

type SerializedEditorTab = {
  kind: "editor";
  id: number;
  path: string;
};

type SerializedMarkdownTab = {
  kind: "markdown";
  id: number;
  path: string;
};
```

### Runtime `PaneNode` extension

`PaneNode` in `src/modules/terminal/lib/panes.ts` gains an optional `sizes?: number[]` on the split variant, mirroring the schema. `PaneTreeView` wires `<ResizablePanelGroup onLayout={(s) => setSplitSizes(splitId, s)}>` and passes `defaultSize={node.sizes?.[i]}` to each `<ResizablePanel>`. `onLayout` fires on drag-release (not per-frame) so no throttling is needed.

### Why ids are persisted

`activeTabId` and `activeLeafId` reference numeric ids generated at runtime by `nextIdRef` in `useTabs`. Without persisting them, the active selection (which tab is foreground, which pane has focus) is lost. On restore, ids are remapped to fresh `nextIdRef`-allocated ones via a small `{ oldId → newId }` translation table built while walking the saved tree.

### What's NOT in the schema

- **Editor `dirty` flag / unsaved buffer contents.** We don't store unsaved edits anywhere durable today. Restoring `dirty: true` without the actual content would lie. All editors restore clean.
- **`pendingSelection`.** One-shot; meaningless after restart.
- **Terminal scrollback.** Fresh PTY, fresh buffer.
- **`preview: true` on EditorTab.** Preview tabs are by definition transient (single-click peeks). Filtering them out at serialize time keeps that invariant.

### Filtered-out tab kinds

When serializing, we silently drop these kinds — they aren't even representable in `SerializedTab`:

- `ai-diff` — references a dead approval id, would crash on restore.
- `git-diff`, `git-history`, `git-commit-file` — transient exploration views tied to past actions; restoring a 3-day-old "Git History" tab is noise.
- `preview` (web URL preview) — questionable usefulness, kept out for v1 simplicity.
- `editor` with `preview: true` — see above.

The type system enforces this allowlist: only the three allowed kinds appear in `SerializedTab`.

---

## 3. Save and restore flow

### New module

`src/modules/tabs/lib/sessionPersistence.ts` exposes:

```ts
function serializeSession(tabs: Tab[], activeId: number): SessionV1;
async function saveSession(key: string, session: SessionV1): Promise<void>;
async function loadSession(key: string): Promise<SessionV1 | null>;
async function clearSession(key: string): Promise<void>;
```

`serializeSession` is pure — walks `tabs`, drops disallowed kinds, recurses through `paneTree` to produce `SerializedPaneNode`s. Easily unit-tested in vitest with fixture trees.

### Save (persistence trigger)

A `useEffect` in `App.tsx`, debounced 300 ms:

```tsx
useEffect(() => {
  if (!restoreSessionPref) return;
  if (!sessionHydrated) return;
  const t = setTimeout(() => {
    void saveSession(sessionKey, serializeSession(tabs, activeId));
  }, 300);
  return () => clearTimeout(t);
}, [tabs, activeId, sessionKey, restoreSessionPref, sessionHydrated]);
```

The `sessionHydrated` guard is critical: without it, the first render after launch (before the loader returned) would persist the default-tab state and overwrite the saved session before we get to restore.

300 ms coalesces rapid tab edits (drag a split, type into a path, etc.) into one write. The debounce is intentionally small enough that a window-close shortly after a tab change still captures the change in most cases.

### Restore (startup gate)

`App.tsx` calls `loadSession(sessionKey)` on mount, before the first `useTabs` render is committed:

1. `App` exposes a `sessionLoaded` state, default `null`. Set to either the restored payload or `"none"` once the async load resolves.
2. Render gate: if `sessionLoaded === null` AND `restoreSessionPref === true`, return a tiny splash (or `null`) for the few ms until the load resolves. Reading one JSON file is sub-10 ms typically.
3. Once `sessionLoaded` resolves, `useTabs` initializes with either the restored payload (replacing the default `[{terminal,…}]`) or the standard default.
4. After init, the persistence effect can start firing freely (`sessionHydrated = true`).

`useTabs` is updated to accept a richer initializer:

```ts
type RestoredInitial = { tabs: Tab[]; activeId: number };
export function useTabs(initial?: Partial<TerminalTab> | RestoredInitial): ...;
```

It translates persisted ids: walks the saved tabs, allocates fresh ids from `nextIdRef`, builds a `{ oldId → newId }` map. `activeTabId` is looked up through that map; if it doesn't appear (e.g. the previously-active tab was an `ai-diff` that got filtered out), fall back to the first tab in the array. Never end up with `activeId === null`.

### Terminal pane restore

Each leaf in the restored `paneTree` becomes a fresh `leafId`. `useTerminalSession`'s `ensureSession(leafId, initialCwd)` already accepts an initial cwd; PTY spawns at that cwd via `pty_open`. If the cwd no longer exists, the current Rust fallback (home directory) applies — no new handling needed.

### Editor restore

Each restored EditorTab opens with its path. `useDocument` already handles missing files via `status: "error"` — the tab renders an error banner instead of crashing. We don't pre-check existence before serializing; one less filesystem call, one less moving part, and the error UI already exists.

### Clear

When the user toggles "Restore previous session" OFF in settings, we call `clearSession(sessionKey)` for the current key. Toggling back ON doesn't restore retroactively — the user must close and reopen — but the next save will populate fresh state.

---

## 4. Settings UI

A new toggle in `src/settings/sections/GeneralSection.tsx`, placed adjacent to the existing `restoreWindowState` toggle (both are startup-affecting behaviors):

```
Restore previous session     [toggle]
   Reopens your tabs and terminal panes from the last session.
   Saved per project directory and environment.
```

The toggle's setter is a new `setRestoreSession(value: boolean)` in `src/modules/settings/store.ts`, following the same pattern as `setRestoreWindowState`:

- `Preferences` type gains `restoreSession: boolean`.
- `KEY_RESTORE_SESSION = "restoreSession"` constant.
- `DEFAULT_PREFERENCES.restoreSession = true` (default ON).
- Loader entry in `loadPreferences`.
- Setter `setRestoreSession`.
- Entry in the `onPreferencesChange` map.

The Zustand `usePreferencesStore` picks up the new field automatically.

---

## 5. Edge cases & error handling

- **Schema mismatch on load** (`version !== 1`): log a warning, return `null` — equivalent to no saved session. Future schema bumps don't crash; users lose only their last session on the upgrade. A formal migration framework is YAGNI until v2.
- **Corrupt JSON / read failure**: same handling — `loadSession` swallows, logs `console.warn("[session] load failed", e)`, returns `null`.
- **Missing files on editor restore**: handled by `useDocument`'s existing error state. No new code.
- **Vanished CWD on terminal restore**: Rust `pty_open` already falls back to home directory. No new code.
- **Concurrent windows with the same session key** (rare): last write wins. The 300 ms debounce can interleave. **Accepted as out-of-scope** for v1; documented as a known limitation. Worst case: one window's tab close gets clobbered by the other window's next debounce.
- **Workspace env switch mid-session**: handled by `sessionKey` being a dep of the persistence effect — new key on next write, old key keeps its last-written state.
- **Active tab restore failure**: when `activeTabId` doesn't appear in the rebuilt id map, fall back to first tab in array. Never `null`.
- **Crash recovery**: with 300 ms-debounced writes, a hard crash loses at most the last ~300 ms of tab activity. Strictly better than saving only on exit.
- **First-update existing users**: no saved state exists yet, so "Restore previous session = ON" has nothing to do on first launch — no surprise.

---

## 6. Out of scope

Explicitly NOT included; do not let the implementation plan absorb these:

- Unsaved-editor-content restoration.
- Restoring AI conversation history (handled separately by `chatStore`).
- Restoring `ai-diff`, `git-diff`, `git-history`, `git-commit-file`, or `preview` tabs.
- Cross-environment session migration (local ↔ WSL).
- Multi-window write conflict resolution.
- Per-session manual save / load (named workspaces). The toggle is binary; persistence is automatic.
- Restoring terminal scrollback / command history.

---

## 7. Files touched

- **New:** `src/modules/tabs/lib/sessionKey.ts` + test
- **New:** `src/modules/tabs/lib/sessionSchema.ts`
- **New:** `src/modules/tabs/lib/sessionSerialize.ts` + test
- **New:** `src/modules/tabs/lib/sessionDeserialize.ts` + test
- **New:** `src/modules/tabs/lib/sessionPersistence.ts`
- **New:** `src/modules/tabs/lib/useSessionLoad.ts`
- **Modified:** `src/modules/terminal/lib/panes.ts` — `sizes?: number[]` on the split variant + `setSplitSizes` helper.
- **Modified:** `src/modules/tabs/lib/useTabs.ts` — accept `RestoredInitial`, id remap on init, `setSplitSizes` mutation.
- **Modified:** `src/modules/terminal/PaneTreeView.tsx` — `onLayout` capture + `defaultSize` replay.
- **Modified:** `src/modules/terminal/TerminalStack.tsx` — thread `onResizeSplit` through.
- **Modified:** `src/modules/settings/store.ts` — `restoreSession` field + constant + default + loader + setter + change-event mapping.
- **Modified:** `src/app/App.tsx` — load + render-gate + persistence effect + session key derivation + `setSplitSizes` wiring.
- **Modified:** `src/settings/sections/GeneralSection.tsx` — new toggle.

---

## 8. Testing strategy

**Unit / vitest:**

- `serializeSession`: fixture covers a terminal tab with split panes, an editor (pinned), an editor (preview — filtered), an AiDiff tab (filtered), a markdown tab; verify the output schema and dropped kinds.
- `serializeSession`: round-trip — deserialize back into an initializer payload, confirm tab counts, paths, and pane-tree shape match.
- Id remap on restore: given a saved session with `activeTabId = 5` and `tabs = [{id:5}, {id:7}]`, after restore both ids should be fresh and `activeTabId` should still point at the formerly-id-5 tab.
- `loadSession` returns `null` on missing key, on corrupted JSON, on `version !== 1`.
- 30-day pruning: a session with `updatedAt = now - 31d` is dropped from the store on read.

**Manual / smoke:**

- Open Terax in `~/projects/foo` with two terminals, one editor, one markdown preview. Quit. Relaunch — same tabs, same active tab, terminal panes have correct cwds.
- Open Terax in `~/projects/bar`. Confirm distinct session (no foo's tabs).
- Toggle "Restore previous session" OFF, relaunch — fresh terminal tab.
- Toggle ON, open a few tabs, quit, relaunch — restored.
- Open an editor for a file, delete that file outside Terax, quit, relaunch — restored editor tab shows error banner, doesn't crash.
- Switch from local to WSL mid-session, open tabs, switch back — local tabs come back.

---

## 9. Open questions

None blocking. Resolved during brainstorming:

- Keying: per launch dir + env.
- Tab scope: terminals, editors, markdown only (preview EditorTabs dropped, not demoted to pinned).
- Default state: ON.
- Startup behavior: gate render until session load completes.
- Persistence trigger: debounced-on-change (300 ms), not on-exit.
