# Session restoration implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save and restore Terminal/Editor/Markdown tabs (with pane layout and CWDs) across Terax restarts, keyed by launch dir + workspace env, gated by a new "Restore previous session" toggle in Settings → General (default ON).

**Architecture:** A new pure-function module serializes the runtime `Tab[]` into a versioned schema, dropping disallowed kinds (`ai-diff`, `git-diff`, etc.). Deserialization remaps persisted ids to fresh `nextIdRef`-allocated ones. Persistence uses a separate Tauri `LazyStore` (`terax-sessions.json`) keyed by `<launchDir-or-"default">::<workspaceScopeKey>` with 30-day pruning on read. App startup gates the first render until `loadSession` resolves, so the default tab can't clobber the saved state before restore.

**Tech Stack:** TypeScript, React 19, Zustand (preferences), Tauri 2 `LazyStore` plugin, vitest.

**Specification:** `docs/superpowers/specs/2026-05-26-session-restoration-design.md`

---

## Codebase orientation (read before starting)

- **Tab state:** `src/modules/tabs/lib/useTabs.ts`. Sets up `tabs` and `activeId` via `useState`, ids allocated from `nextIdRef = useRef(3)`. The initial state is hard-coded to one terminal tab `{id:1, leafId:2}`. We extend the initializer to accept a restored payload.
- **Tab types:** `src/modules/tabs/lib/useTabs.ts:19-115` — `TerminalTab`, `EditorTab`, `PreviewTab`, `MarkdownTab`, `AiDiffTab`, `GitDiffTab`, `GitHistoryTab`, `GitCommitFileDiffTab`, plus the `Tab` union.
- **Pane tree:** `src/modules/terminal/lib/panes.ts`. `PaneNode = { kind:"leaf", id, cwd? } | { kind:"split", id, dir, children: PaneNode[] }`. N-way splits (children array, not a/b). No ratio.
- **Settings store:** `src/modules/settings/store.ts`. Two-layer: schema/persistence (`store.ts`) + Zustand wrapper (`preferences.ts`). To add a new pref: extend `Preferences`, add `KEY_*` const, add to `DEFAULT_PREFERENCES`, add load entry in `loadPreferences`, add setter, add to `onPreferencesChange` map. Existing `restoreWindowState` is the closest analog.
- **Preferences store consumer:** `src/modules/settings/preferences.ts` — auto-picks up new fields, no change needed.
- **General settings UI:** `src/settings/sections/GeneralSection.tsx` — has the existing "Restore window state" toggle to mirror.
- **App composition:** `src/app/App.tsx:191` — current `useTabs` invocation. `:81` imports `useTabs, useWorkspaceCwd` from `@/modules/tabs`. `:49` imports `getLaunchDir`. `:106-110` imports workspace env helpers.
- **LazyStore pattern:** `src/modules/settings/store.ts:204` — `const store = new LazyStore("terax-settings.json", { defaults: {}, autoSave: 200 })`. Same pattern for the new session store, different file name.
- **Workspace key:** `src/modules/workspace/env.ts` — `currentWorkspaceScopeKey()` returns `"local"` or `"wsl:<distro>"`.
- **Launch dir:** `src/lib/launchDir.ts` — `getLaunchDir(): string | undefined`. Drained on first read (per its comment), so we must read once and cache.

---

## Task 1: Add `restoreSession` preference

**Files:**
- Modify: `src/modules/settings/store.ts`

The setter mirrors `setRestoreWindowState`. Default is `true` — restoring is the modern editor expectation, and there's no saved state on first launch, so no surprise for existing users.

- [ ] **Step 1: Add the type field**

In `src/modules/settings/store.ts`, find the `Preferences` type and add `restoreSession: boolean;` next to the existing `restoreWindowState`:

```ts
restoreWindowState: boolean;
restoreSession: boolean;
```

- [ ] **Step 2: Add the KEY constant**

Near the other `const KEY_*` declarations, add:

```ts
const KEY_RESTORE_SESSION = "restoreSession";
```

- [ ] **Step 3: Add the default**

In `DEFAULT_PREFERENCES`, next to `restoreWindowState`:

```ts
restoreWindowState: true,
restoreSession: true,
```

(Inspect the actual current default for `restoreWindowState` — it might be `false`; place `restoreSession: true` on the next line regardless.)

- [ ] **Step 4: Add the loader**

In `loadPreferences`, add a new entry in the returned object (in the same area as `restoreWindowState`):

```ts
restoreSession:
  get<boolean>(KEY_RESTORE_SESSION) ??
  DEFAULT_PREFERENCES.restoreSession,
```

- [ ] **Step 5: Add the setter**

Below the existing `setRestoreWindowState`, add:

```ts
export async function setRestoreSession(value: boolean): Promise<void> {
  await writePref(KEY_RESTORE_SESSION, value);
}
```

- [ ] **Step 6: Add the change-listener mapping**

In `onPreferencesChange`, inside the `map` object, add:

```ts
[KEY_RESTORE_SESSION]: "restoreSession",
```

- [ ] **Step 7: Verify build**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/modules/settings/store.ts
git commit -m "feat(prefs): add restoreSession preference (default ON)"
```

---

## Task 2: Add the toggle to General settings

**Files:**
- Modify: `src/settings/sections/GeneralSection.tsx`

- [ ] **Step 1: Add imports**

In `src/settings/sections/GeneralSection.tsx`, add `setRestoreSession` to the existing import from `@/modules/settings/store`:

```ts
import {
  // ... existing imports
  setRestoreSession,
} from "@/modules/settings/store";
```

- [ ] **Step 2: Read the preference value**

In the `GeneralSection` component, alongside the existing `restoreWindowState` selector, add:

```ts
const restoreSession = usePreferencesStore((s) => s.restoreSession);
```

- [ ] **Step 3: Add the toggle row**

Find the `SettingRow` that renders the existing "Restore window state" toggle. Immediately after it, add a new row:

```tsx
<SettingRow
  title="Restore previous session"
  description="Reopens your tabs and terminal panes from the last session. Saved per project directory and environment."
>
  <Switch
    checked={restoreSession}
    onCheckedChange={(next) => void setRestoreSession(next)}
  />
</SettingRow>
```

- [ ] **Step 4: Verify build**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/settings/sections/GeneralSection.tsx
git commit -m "feat(settings): add 'Restore previous session' toggle"
```

---

## Task 3: Session-key derivation helper

**Files:**
- Create: `src/modules/tabs/lib/sessionKey.ts`
- Create: `src/modules/tabs/lib/sessionKey.test.ts`

A pure function that combines launch dir and workspace scope key into the storage key. Pulled into its own file so it can be unit-tested independently of `App.tsx`'s wiring.

- [ ] **Step 1: Write the failing test**

Create `src/modules/tabs/lib/sessionKey.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sessionKey } from "./sessionKey";

describe("sessionKey", () => {
  it("combines launch dir and workspace scope", () => {
    expect(sessionKey("/Users/kalle/projects/foo", "local")).toBe(
      "/Users/kalle/projects/foo::local",
    );
  });

  it("uses 'default' when launch dir is undefined", () => {
    expect(sessionKey(undefined, "local")).toBe("default::local");
  });

  it("uses 'default' when launch dir is the empty string", () => {
    expect(sessionKey("", "local")).toBe("default::local");
  });

  it("includes the WSL distro in the workspace key", () => {
    expect(sessionKey("/srv/foo", "wsl:Ubuntu")).toBe("/srv/foo::wsl:Ubuntu");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/modules/tabs/lib/sessionKey.test.ts`
Expected: FAIL — `Cannot find module './sessionKey'`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/tabs/lib/sessionKey.ts`:

```ts
/**
 * Compose the storage key for a saved session. Launch dir partitions
 * sessions per project so `terax ~/projects/foo` and `terax ~/projects/bar`
 * keep separate tab sets; falsy launch dir collapses to a shared "default"
 * key (typical of icon-launched windows).
 */
export function sessionKey(
  launchDir: string | undefined,
  workspaceScope: string,
): string {
  const base = launchDir && launchDir.length > 0 ? launchDir : "default";
  return `${base}::${workspaceScope}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/modules/tabs/lib/sessionKey.test.ts`
Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/tabs/lib/sessionKey.ts src/modules/tabs/lib/sessionKey.test.ts
git commit -m "feat(tabs): session-key derivation helper"
```

---

## Task 4: Extend `PaneNode` with optional split sizes

**Files:**
- Modify: `src/modules/terminal/lib/panes.ts`
- Modify: `src/modules/tabs/lib/useTabs.ts` (add `setSplitSizes` mutation)

`react-resizable-panels` already manages live sizes internally; we just need to capture them on drag-release (`onLayout`) and feed them back on next mount (`defaultSize`). This task adds the type field + mutation; Task 9 wires the render side.

- [ ] **Step 1: Add `sizes?: number[]` to the split variant of `PaneNode`**

In `src/modules/terminal/lib/panes.ts`, change:

```ts
export type PaneNode =
  | { kind: "leaf"; id: PaneId; cwd?: string }
  | {
      kind: "split";
      id: PaneId;
      dir: SplitDir;
      children: PaneNode[];
    };
```

to:

```ts
export type PaneNode =
  | { kind: "leaf"; id: PaneId; cwd?: string }
  | {
      kind: "split";
      id: PaneId;
      dir: SplitDir;
      children: PaneNode[];
      /**
       * Per-child sizes (percent, sums to ~100). Captured by `onLayout`
       * after a resize drag, replayed via `defaultSize` on next mount.
       * Omitted means equal-share layout (the library's default).
       */
      sizes?: number[];
    };
```

- [ ] **Step 2: Add a `setPaneSizes` helper to `panes.ts`**

At the end of `src/modules/terminal/lib/panes.ts`, add:

```ts
/**
 * Set `sizes` on the split with the given id. Returns a new tree (or the
 * original reference if the split was not found or the sizes were already
 * equal). Walks the tree rather than indexing because the renderer reports
 * sizes by split id, not by position.
 */
export function setSplitSizes(
  tree: PaneNode,
  splitId: PaneId,
  sizes: number[],
): PaneNode {
  if (isLeaf(tree)) return tree;
  if (tree.id === splitId) {
    // Skip the update if nothing changed (avoids spurious re-renders).
    if (
      tree.sizes &&
      tree.sizes.length === sizes.length &&
      tree.sizes.every((v, i) => v === sizes[i])
    ) {
      return tree;
    }
    return { ...tree, sizes };
  }
  let changed = false;
  const next = tree.children.map((c) => {
    const u = setSplitSizes(c, splitId, sizes);
    if (u !== c) changed = true;
    return u;
  });
  return changed ? { ...tree, children: next } : tree;
}
```

- [ ] **Step 3: Add `setSplitSizes` mutation in `useTabs`**

In `src/modules/tabs/lib/useTabs.ts`:

(a) Add `setSplitSizes` to the existing import from `@/modules/terminal/lib/panes` (likely aliased — match the existing style, e.g. `setSplitSizes as setSplitSizesInTree`):

```ts
import {
  // ... existing imports
  setSplitSizes as setSplitSizesInTree,
} from "@/modules/terminal/lib/panes";
```

(b) Inside `useTabs`, alongside existing `setLeafCwd` and pane mutations (search for `const setLeafCwd = useCallback`), add:

```ts
const setSplitSizes = useCallback(
  (tabId: number, splitId: number, sizes: number[]) => {
    setTabs((curr) =>
      curr.map((t) => {
        if (t.kind !== "terminal" || t.id !== tabId) return t;
        const paneTree = setSplitSizesInTree(t.paneTree, splitId, sizes);
        if (paneTree === t.paneTree) return t;
        return { ...t, paneTree };
      }),
    );
  },
  [],
);
```

(c) Export `setSplitSizes` from the returned object of `useTabs` (next to `setLeafCwd`).

- [ ] **Step 4: Verify build**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/modules/terminal/lib/panes.ts src/modules/tabs/lib/useTabs.ts
git commit -m "feat(panes): track split-pane sizes in PaneNode"
```

---

## Task 5: Serialization — `serializeSession`

**Files:**
- Create: `src/modules/tabs/lib/sessionSchema.ts`
- Create: `src/modules/tabs/lib/sessionSerialize.ts`
- Create: `src/modules/tabs/lib/sessionSerialize.test.ts`

The schema lives in its own file (shared by serialize + deserialize). `serializeSession` is the pure transformation tabs → SessionV1.

- [ ] **Step 1: Define the schema types**

Create `src/modules/tabs/lib/sessionSchema.ts`:

```ts
/** Storage schema for a saved tab session. Versioned so future tab-kind
 *  additions don't break old saves. */
export const SESSION_SCHEMA_VERSION = 1 as const;

export type SerializedPaneNode =
  | { kind: "leaf"; id: number; cwd: string | null }
  | {
      kind: "split";
      id: number;
      dir: "row" | "col";
      children: SerializedPaneNode[];
      /** Per-child sizes (percent, sums to ~100); optional. */
      sizes?: number[];
    };

export type SerializedTerminalTab = {
  kind: "terminal";
  id: number;
  title: string;
  cwd: string | null;
  paneTree: SerializedPaneNode;
  activeLeafId: number;
  private?: boolean;
};

export type SerializedEditorTab = {
  kind: "editor";
  id: number;
  path: string;
};

export type SerializedMarkdownTab = {
  kind: "markdown";
  id: number;
  path: string;
};

export type SerializedTab =
  | SerializedTerminalTab
  | SerializedEditorTab
  | SerializedMarkdownTab;

export type SessionV1 = {
  version: 1;
  updatedAt: number;
  activeTabId: number | null;
  tabs: SerializedTab[];
};
```

- [ ] **Step 2: Write the failing test**

Create `src/modules/tabs/lib/sessionSerialize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Tab } from "./useTabs";
import { serializeSession } from "./sessionSerialize";
import { SESSION_SCHEMA_VERSION } from "./sessionSchema";

const NOW = 1748275200000; // 2025-05-26T12:00:00Z, stable for tests

function withFakeNow<T>(fn: () => T): T {
  const real = Date.now;
  Date.now = () => NOW;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}

describe("serializeSession", () => {
  it("returns the schema version and timestamp", () => {
    const out = withFakeNow(() => serializeSession([], 0));
    expect(out.version).toBe(SESSION_SCHEMA_VERSION);
    expect(out.updatedAt).toBe(NOW);
    expect(out.activeTabId).toBe(null);
    expect(out.tabs).toEqual([]);
  });

  it("serializes a terminal tab with a single leaf", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        kind: "terminal",
        title: "shell",
        cwd: "/home/me",
        paneTree: { kind: "leaf", id: 2, cwd: "/home/me" },
        activeLeafId: 2,
      },
    ];
    const out = withFakeNow(() => serializeSession(tabs, 1));
    expect(out.tabs).toEqual([
      {
        kind: "terminal",
        id: 1,
        title: "shell",
        cwd: "/home/me",
        paneTree: { kind: "leaf", id: 2, cwd: "/home/me" },
        activeLeafId: 2,
      },
    ]);
    expect(out.activeTabId).toBe(1);
  });

  it("serializes a terminal tab with a split (n-ary children)", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        kind: "terminal",
        title: "shell",
        cwd: undefined,
        paneTree: {
          kind: "split",
          id: 2,
          dir: "row",
          children: [
            { kind: "leaf", id: 3, cwd: "/a" },
            { kind: "leaf", id: 4, cwd: "/b" },
            { kind: "leaf", id: 5, cwd: undefined },
          ],
        },
        activeLeafId: 4,
      },
    ];
    const out = withFakeNow(() => serializeSession(tabs, 1));
    expect(out.tabs[0]).toMatchObject({
      kind: "terminal",
      paneTree: {
        kind: "split",
        id: 2,
        dir: "row",
        children: [
          { kind: "leaf", id: 3, cwd: "/a" },
          { kind: "leaf", id: 4, cwd: "/b" },
          { kind: "leaf", id: 5, cwd: null },
        ],
      },
      activeLeafId: 4,
    });
  });

  it("includes split sizes when set, omits when absent", () => {
    const withSizes: Tab[] = [
      {
        id: 1,
        kind: "terminal",
        title: "shell",
        paneTree: {
          kind: "split",
          id: 2,
          dir: "row",
          children: [
            { kind: "leaf", id: 3 },
            { kind: "leaf", id: 4 },
          ],
          sizes: [30, 70],
        },
        activeLeafId: 3,
      },
    ];
    const out = withFakeNow(() => serializeSession(withSizes, 1));
    expect(out.tabs[0]).toMatchObject({
      paneTree: { kind: "split", sizes: [30, 70] },
    });

    const withoutSizes: Tab[] = [
      {
        id: 1,
        kind: "terminal",
        title: "shell",
        paneTree: {
          kind: "split",
          id: 2,
          dir: "row",
          children: [
            { kind: "leaf", id: 3 },
            { kind: "leaf", id: 4 },
          ],
        },
        activeLeafId: 3,
      },
    ];
    const out2 = withFakeNow(() => serializeSession(withoutSizes, 1));
    expect((out2.tabs[0] as { paneTree: { sizes?: number[] } }).paneTree.sizes).toBeUndefined();
  });

  it("serializes editor and markdown tabs", () => {
    const tabs: Tab[] = [
      {
        id: 10,
        kind: "editor",
        title: "App.tsx",
        path: "/p/App.tsx",
        dirty: false,
        preview: false,
      },
      { id: 11, kind: "markdown", title: "README", path: "/p/README.md" },
    ];
    const out = withFakeNow(() => serializeSession(tabs, 10));
    expect(out.tabs).toEqual([
      { kind: "editor", id: 10, path: "/p/App.tsx" },
      { kind: "markdown", id: 11, path: "/p/README.md" },
    ]);
  });

  it("drops preview editor tabs", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        kind: "editor",
        title: "Pinned",
        path: "/a",
        dirty: false,
        preview: false,
      },
      {
        id: 2,
        kind: "editor",
        title: "Preview",
        path: "/b",
        dirty: false,
        preview: true,
      },
    ];
    const out = withFakeNow(() => serializeSession(tabs, 2));
    expect(out.tabs.map((t) => t.id)).toEqual([1]);
    // activeTabId pointed at a dropped tab; serializer leaves the id alone,
    // deserializer is responsible for the fallback.
    expect(out.activeTabId).toBe(2);
  });

  it("drops ai-diff, git-diff, git-history, git-commit-file, preview kinds", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        kind: "terminal",
        title: "shell",
        paneTree: { kind: "leaf", id: 2 },
        activeLeafId: 2,
      },
      {
        id: 3,
        kind: "ai-diff",
        title: "diff",
        path: "/a",
        originalContent: "",
        proposedContent: "",
        approvalId: "x",
        status: "pending",
        isNewFile: false,
      },
      {
        id: 4,
        kind: "git-diff",
        title: "diff",
        path: "/a",
        repoRoot: "/r",
        mode: "-",
        originalPath: null,
      },
      { id: 5, kind: "git-history", title: "hist", repoRoot: "/r" },
      {
        id: 6,
        kind: "git-commit-file",
        title: "c",
        repoRoot: "/r",
        sha: "abc",
        shortSha: "abc",
        subject: "x",
        path: "/a",
        originalPath: null,
      },
      { id: 7, kind: "preview", title: "p", url: "https://x" },
    ];
    const out = withFakeNow(() => serializeSession(tabs, 1));
    expect(out.tabs.map((t) => t.id)).toEqual([1]);
  });

  it("converts undefined cwds to null in the schema", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        kind: "terminal",
        title: "shell",
        cwd: undefined,
        paneTree: { kind: "leaf", id: 2, cwd: undefined },
        activeLeafId: 2,
      },
    ];
    const out = withFakeNow(() => serializeSession(tabs, 1));
    expect(out.tabs[0]).toMatchObject({
      cwd: null,
      paneTree: { kind: "leaf", id: 2, cwd: null },
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test src/modules/tabs/lib/sessionSerialize.test.ts`
Expected: FAIL — `Cannot find module './sessionSerialize'`.

- [ ] **Step 4: Write the implementation**

Create `src/modules/tabs/lib/sessionSerialize.ts`:

```ts
import type { PaneNode } from "@/modules/terminal/lib/panes";
import {
  SESSION_SCHEMA_VERSION,
  type SerializedPaneNode,
  type SerializedTab,
  type SessionV1,
} from "./sessionSchema";
import type { Tab } from "./useTabs";

function serializePaneNode(node: PaneNode): SerializedPaneNode {
  if (node.kind === "leaf") {
    return { kind: "leaf", id: node.id, cwd: node.cwd ?? null };
  }
  const out: SerializedPaneNode = {
    kind: "split",
    id: node.id,
    dir: node.dir,
    children: node.children.map(serializePaneNode),
  };
  if (node.sizes) out.sizes = node.sizes;
  return out;
}

function serializeTab(tab: Tab): SerializedTab | null {
  if (tab.kind === "terminal") {
    const serialized: SerializedTab = {
      kind: "terminal",
      id: tab.id,
      title: tab.title,
      cwd: tab.cwd ?? null,
      paneTree: serializePaneNode(tab.paneTree),
      activeLeafId: tab.activeLeafId,
    };
    if (tab.private) serialized.private = true;
    return serialized;
  }
  if (tab.kind === "editor") {
    if (tab.preview) return null; // preview = ephemeral, don't restore
    return { kind: "editor", id: tab.id, path: tab.path };
  }
  if (tab.kind === "markdown") {
    return { kind: "markdown", id: tab.id, path: tab.path };
  }
  // ai-diff, git-diff, git-history, git-commit-file, preview: dropped.
  return null;
}

export function serializeSession(tabs: Tab[], activeId: number): SessionV1 {
  const serialized: SerializedTab[] = [];
  for (const tab of tabs) {
    const out = serializeTab(tab);
    if (out !== null) serialized.push(out);
  }
  return {
    version: SESSION_SCHEMA_VERSION,
    updatedAt: Date.now(),
    activeTabId: tabs.length > 0 ? activeId : null,
    tabs: serialized,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/modules/tabs/lib/sessionSerialize.test.ts`
Expected: 8/8 pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/tabs/lib/sessionSchema.ts src/modules/tabs/lib/sessionSerialize.ts src/modules/tabs/lib/sessionSerialize.test.ts
git commit -m "feat(tabs): serialize tabs to versioned session schema"
```

---

## Task 6: Deserialization — `deserializeSession`

**Files:**
- Create: `src/modules/tabs/lib/sessionDeserialize.ts`
- Create: `src/modules/tabs/lib/sessionDeserialize.test.ts`

Takes a stored SessionV1 plus an id allocator and returns a `RestoredInitial = { tabs: Tab[]; activeId: number; nextId: number }`. Schema-validates the input; returns `null` on version mismatch or shape errors. Allocates fresh ids and remaps `activeTabId` and pane `activeLeafId` through the remap table.

- [ ] **Step 1: Write the failing test**

Create `src/modules/tabs/lib/sessionDeserialize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deserializeSession } from "./sessionDeserialize";
import type { SessionV1 } from "./sessionSchema";

describe("deserializeSession", () => {
  it("returns null for null/undefined input", () => {
    expect(deserializeSession(null, 1)).toBe(null);
    expect(deserializeSession(undefined, 1)).toBe(null);
  });

  it("returns null when version is not 1", () => {
    const bad = { version: 2, updatedAt: 0, activeTabId: null, tabs: [] };
    expect(deserializeSession(bad as unknown, 1)).toBe(null);
  });

  it("returns null when the shape is malformed", () => {
    expect(deserializeSession({ version: 1 } as unknown, 1)).toBe(null);
    expect(
      deserializeSession(
        { version: 1, updatedAt: 0, activeTabId: null, tabs: "nope" } as unknown,
        1,
      ),
    ).toBe(null);
  });

  it("returns empty result when tabs is empty", () => {
    const empty: SessionV1 = {
      version: 1,
      updatedAt: 0,
      activeTabId: null,
      tabs: [],
    };
    const r = deserializeSession(empty, 100);
    expect(r).not.toBe(null);
    expect(r!.tabs).toEqual([]);
    expect(r!.activeId).toBe(0);
    expect(r!.nextId).toBe(100);
  });

  it("remaps tab and leaf ids starting at the provided seed", () => {
    const saved: SessionV1 = {
      version: 1,
      updatedAt: 0,
      activeTabId: 5,
      tabs: [
        {
          kind: "terminal",
          id: 5,
          title: "shell",
          cwd: "/x",
          paneTree: {
            kind: "split",
            id: 6,
            dir: "row",
            children: [
              { kind: "leaf", id: 7, cwd: "/x" },
              { kind: "leaf", id: 8, cwd: "/y" },
            ],
          },
          activeLeafId: 8,
        },
      ],
    };
    const r = deserializeSession(saved, 100)!;
    expect(r.tabs).toHaveLength(1);
    const t = r.tabs[0];
    expect(t.kind).toBe("terminal");
    expect(t.id).toBe(100);
    expect(r.activeId).toBe(100);
    if (t.kind !== "terminal") throw new Error();
    expect(t.paneTree.kind).toBe("split");
    if (t.paneTree.kind !== "split") throw new Error();
    expect(t.paneTree.id).toBe(101);
    expect(t.paneTree.children[0].id).toBe(102);
    expect(t.paneTree.children[1].id).toBe(103);
    expect(t.activeLeafId).toBe(103);
    expect(r.nextId).toBe(104);
  });

  it("falls back activeId to the first tab when the saved activeTabId is not in the array", () => {
    const saved: SessionV1 = {
      version: 1,
      updatedAt: 0,
      activeTabId: 999, // not present in tabs
      tabs: [
        {
          kind: "editor",
          id: 1,
          path: "/a",
        },
      ],
    };
    const r = deserializeSession(saved, 50)!;
    expect(r.tabs).toHaveLength(1);
    expect(r.activeId).toBe(50); // first tab's remapped id
  });

  it("restores editor and markdown tabs with default fields", () => {
    const saved: SessionV1 = {
      version: 1,
      updatedAt: 0,
      activeTabId: 1,
      tabs: [
        { kind: "editor", id: 1, path: "/a" },
        { kind: "markdown", id: 2, path: "/b" },
      ],
    };
    const r = deserializeSession(saved, 10)!;
    expect(r.tabs[0]).toEqual({
      id: 10,
      kind: "editor",
      title: "a",
      path: "/a",
      dirty: false,
      preview: false,
    });
    expect(r.tabs[1]).toEqual({ id: 11, kind: "markdown", title: "b", path: "/b" });
  });

  it("carries split sizes through when shape matches; drops them when mismatched", () => {
    const good: SessionV1 = {
      version: 1,
      updatedAt: 0,
      activeTabId: 1,
      tabs: [
        {
          kind: "terminal",
          id: 1,
          title: "shell",
          cwd: null,
          paneTree: {
            kind: "split",
            id: 2,
            dir: "row",
            children: [
              { kind: "leaf", id: 3, cwd: null },
              { kind: "leaf", id: 4, cwd: null },
            ],
            sizes: [30, 70],
          },
          activeLeafId: 3,
        },
      ],
    };
    const r = deserializeSession(good, 100)!;
    const t = r.tabs[0];
    if (t.kind !== "terminal" || t.paneTree.kind !== "split") throw new Error();
    expect(t.paneTree.sizes).toEqual([30, 70]);

    // Mismatched sizes (3 entries but only 2 children) are silently dropped.
    const bad = JSON.parse(JSON.stringify(good)) as SessionV1;
    (bad.tabs[0] as { paneTree: { sizes: number[] } }).paneTree.sizes = [
      10, 20, 70,
    ];
    const r2 = deserializeSession(bad, 100)!;
    const t2 = r2.tabs[0];
    if (t2.kind !== "terminal" || t2.paneTree.kind !== "split") throw new Error();
    expect(t2.paneTree.sizes).toBeUndefined();
  });

  it("preserves private flag on terminal tabs", () => {
    const saved: SessionV1 = {
      version: 1,
      updatedAt: 0,
      activeTabId: 1,
      tabs: [
        {
          kind: "terminal",
          id: 1,
          title: "private",
          cwd: null,
          paneTree: { kind: "leaf", id: 2, cwd: null },
          activeLeafId: 2,
          private: true,
        },
      ],
    };
    const r = deserializeSession(saved, 100)!;
    const t = r.tabs[0];
    if (t.kind !== "terminal") throw new Error();
    expect(t.private).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/modules/tabs/lib/sessionDeserialize.test.ts`
Expected: FAIL — `Cannot find module './sessionDeserialize'`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/tabs/lib/sessionDeserialize.ts`:

```ts
import type { PaneNode } from "@/modules/terminal/lib/panes";
import {
  SESSION_SCHEMA_VERSION,
  type SerializedPaneNode,
  type SerializedTab,
  type SessionV1,
} from "./sessionSchema";
import type { EditorTab, MarkdownTab, Tab, TerminalTab } from "./useTabs";

export interface RestoredInitial {
  tabs: Tab[];
  activeId: number;
  /** Next free id; assign to nextIdRef.current after restore. */
  nextId: number;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function isSessionV1(input: unknown): input is SessionV1 {
  if (!input || typeof input !== "object") return false;
  const o = input as Record<string, unknown>;
  if (o.version !== SESSION_SCHEMA_VERSION) return false;
  if (typeof o.updatedAt !== "number") return false;
  if (o.activeTabId !== null && typeof o.activeTabId !== "number") return false;
  if (!Array.isArray(o.tabs)) return false;
  return true;
}

function remapPaneNode(
  node: SerializedPaneNode,
  alloc: () => number,
  leafMap: Map<number, number>,
): PaneNode {
  if (node.kind === "leaf") {
    const newId = alloc();
    leafMap.set(node.id, newId);
    const leaf: PaneNode = { kind: "leaf", id: newId };
    if (node.cwd !== null && node.cwd !== undefined) leaf.cwd = node.cwd;
    return leaf;
  }
  const split: PaneNode = {
    kind: "split",
    id: alloc(),
    dir: node.dir,
    children: node.children.map((c) => remapPaneNode(c, alloc, leafMap)),
  };
  // Only carry sizes through if they match children.length — defensive guard
  // against malformed saves that survive the shape check (e.g. someone
  // hand-edits the JSON and trims children but leaves sizes).
  if (
    node.sizes &&
    Array.isArray(node.sizes) &&
    node.sizes.length === node.children.length
  ) {
    split.sizes = node.sizes;
  }
  return split;
}

function restoreTab(
  s: SerializedTab,
  alloc: () => number,
  tabMap: Map<number, number>,
): Tab {
  const newId = alloc();
  tabMap.set(s.id, newId);
  if (s.kind === "terminal") {
    const leafMap = new Map<number, number>();
    const paneTree = remapPaneNode(s.paneTree, alloc, leafMap);
    const activeLeafId = leafMap.get(s.activeLeafId);
    const tab: TerminalTab = {
      id: newId,
      kind: "terminal",
      title: s.title,
      paneTree,
      activeLeafId: activeLeafId ?? (paneTree.kind === "leaf" ? paneTree.id : firstLeafId(paneTree)),
    };
    if (s.cwd) tab.cwd = s.cwd;
    if (s.private) tab.private = true;
    return tab;
  }
  if (s.kind === "editor") {
    const tab: EditorTab = {
      id: newId,
      kind: "editor",
      title: basename(s.path),
      path: s.path,
      dirty: false,
      preview: false,
    };
    return tab;
  }
  const tab: MarkdownTab = {
    id: newId,
    kind: "markdown",
    title: basename(s.path),
    path: s.path,
  };
  return tab;
}

function firstLeafId(node: PaneNode): number {
  if (node.kind === "leaf") return node.id;
  for (const c of node.children) {
    const x = firstLeafId(c);
    if (x !== -1) return x;
  }
  return -1;
}

export function deserializeSession(
  input: unknown,
  startId: number,
): RestoredInitial | null {
  if (!isSessionV1(input)) return null;

  let next = startId;
  const alloc = () => next++;
  const tabMap = new Map<number, number>();
  const tabs: Tab[] = [];
  for (const s of input.tabs) {
    try {
      tabs.push(restoreTab(s, alloc, tabMap));
    } catch (e) {
      console.warn("[session] skipping malformed tab", e);
    }
  }
  const activeId =
    input.activeTabId !== null && tabMap.has(input.activeTabId)
      ? tabMap.get(input.activeTabId)!
      : tabs[0]?.id ?? 0;

  return { tabs, activeId, nextId: next };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/modules/tabs/lib/sessionDeserialize.test.ts`
Expected: 9/9 pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/tabs/lib/sessionDeserialize.ts src/modules/tabs/lib/sessionDeserialize.test.ts
git commit -m "feat(tabs): deserialize session with id remap + schema check"
```

---

## Task 7: Persistence integration — `sessionPersistence.ts`

**Files:**
- Create: `src/modules/tabs/lib/sessionPersistence.ts`

The LazyStore-backed save/load/clear with 30-day prune on read. No tests (it's I/O glue; the pure pieces are tested separately).

- [ ] **Step 1: Implement the module**

Create `src/modules/tabs/lib/sessionPersistence.ts`:

```ts
import { LazyStore } from "@tauri-apps/plugin-store";
import { deserializeSession, type RestoredInitial } from "./sessionDeserialize";
import type { SessionV1 } from "./sessionSchema";

const SESSIONS_STORE_PATH = "terax-sessions.json";
const PRUNE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const store = new LazyStore(SESSIONS_STORE_PATH, {
  defaults: {},
  autoSave: 200,
});

/**
 * Drop entries older than PRUNE_AGE_MS. Best-effort: failures are swallowed
 * so a corrupted entry can't block restore of unrelated keys.
 */
async function pruneOldSessions(): Promise<void> {
  try {
    const keys = await store.keys();
    const now = Date.now();
    for (const key of keys) {
      const value = await store.get<SessionV1 | undefined>(key);
      if (!value || typeof value !== "object") continue;
      const updatedAt = (value as SessionV1).updatedAt;
      if (typeof updatedAt !== "number") continue;
      if (now - updatedAt > PRUNE_AGE_MS) {
        await store.delete(key);
      }
    }
  } catch (e) {
    console.warn("[session] prune failed", e);
  }
}

export async function loadSession(
  key: string,
  startId: number,
): Promise<RestoredInitial | null> {
  // Prune in the background; do not block the caller.
  void pruneOldSessions();
  try {
    const raw = await store.get<SessionV1 | undefined>(key);
    if (raw === undefined) return null;
    return deserializeSession(raw, startId);
  } catch (e) {
    console.warn("[session] load failed", e);
    return null;
  }
}

export async function saveSession(
  key: string,
  session: SessionV1,
): Promise<void> {
  try {
    await store.set(key, session);
  } catch (e) {
    console.warn("[session] save failed", e);
  }
}

export async function clearSession(key: string): Promise<void> {
  try {
    await store.delete(key);
  } catch (e) {
    console.warn("[session] clear failed", e);
  }
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/modules/tabs/lib/sessionPersistence.ts
git commit -m "feat(tabs): LazyStore-backed session persistence + pruning"
```

---

## Task 8: Extend `useTabs` to accept a restored initializer

**Files:**
- Modify: `src/modules/tabs/lib/useTabs.ts`

`useTabs` currently accepts `initial?: Partial<TerminalTab>`. We widen it to also accept a `RestoredInitial`. When a restored payload is passed, the initial state and `nextIdRef` come from it; the default-tab fallback is unchanged.

- [ ] **Step 1: Apply the change**

In `src/modules/tabs/lib/useTabs.ts`, find the `useTabs` function signature and the surrounding state initialization (currently around line 141):

```ts
export function useTabs(initial?: Partial<TerminalTab>) {
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const tabId = 1;
    const leafId = 2;
    return [
      {
        id: tabId,
        kind: "terminal",
        title: initial?.title ?? "shell",
        cwd: initial?.cwd,
        paneTree: { kind: "leaf", id: leafId, cwd: initial?.cwd },
        activeLeafId: leafId,
      },
    ];
  });
  const [activeId, setActiveId] = useState(1);
  const nextIdRef = useRef(3);
```

Add an import at the top of the file:

```ts
import type { RestoredInitial } from "./sessionDeserialize";
```

Then replace the function signature and initializer block with:

```ts
export type UseTabsInitial =
  | (Partial<TerminalTab> & { restored?: undefined })
  | { restored: RestoredInitial };

export function useTabs(initial?: UseTabsInitial) {
  const restored =
    initial && "restored" in initial ? initial.restored : undefined;

  const [tabs, setTabs] = useState<Tab[]>(() => {
    if (restored && restored.tabs.length > 0) return restored.tabs;
    const tabId = 1;
    const leafId = 2;
    const defaultCwd =
      initial && "restored" in initial ? undefined : initial?.cwd;
    const defaultTitle =
      initial && "restored" in initial ? "shell" : (initial?.title ?? "shell");
    return [
      {
        id: tabId,
        kind: "terminal",
        title: defaultTitle,
        cwd: defaultCwd,
        paneTree: { kind: "leaf", id: leafId, cwd: defaultCwd },
        activeLeafId: leafId,
      },
    ];
  });
  const [activeId, setActiveId] = useState<number>(() =>
    restored && restored.tabs.length > 0 ? restored.activeId : 1,
  );
  const nextIdRef = useRef<number>(
    restored && restored.tabs.length > 0 ? restored.nextId : 3,
  );
```

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: succeeds. Existing callers passing `{ cwd: ... }` continue to work because that shape narrows to the first arm of `UseTabsInitial`.

- [ ] **Step 3: Verify existing tests still pass**

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/modules/tabs/lib/useTabs.ts
git commit -m "feat(tabs): accept RestoredInitial in useTabs initializer"
```

---

## Task 9: Wire split-size capture in `PaneTreeView`

**Files:**
- Modify: `src/modules/terminal/PaneTreeView.tsx`
- Modify: `src/modules/terminal/TerminalStack.tsx`
- Modify: `src/app/App.tsx` (thread `setSplitSizes` from `useTabs` into `TerminalStack`)

`react-resizable-panels` fires `onLayout(sizes)` on `<ResizablePanelGroup>` when the user releases the drag. We capture that into `useTabs`'s `setSplitSizes` (added in Task 4). We also pass each child's `defaultSize` so the next mount restores the prior layout.

- [ ] **Step 1: Add an `onResizeSplit` prop to `PaneTreeView`**

In `src/modules/terminal/PaneTreeView.tsx`, change the `Props` type:

```ts
type Props = {
  node: PaneNode;
  tabVisible: boolean;
  activeLeafId: number;
  onFocusLeaf: (leafId: number) => void;
  getBundle: (leafId: number) => LeafBundle;
  /** Called when the user finishes resizing a split. */
  onResizeSplit: (splitId: number, sizes: number[]) => void;
};
```

Destructure `onResizeSplit` in the function signature alongside the others.

- [ ] **Step 2: Wire `onLayout` on the split renderer**

Still in `PaneTreeView.tsx`, change the split branch's return value from:

```tsx
return (
  <ResizablePanelGroup
    orientation={node.dir === "row" ? "horizontal" : "vertical"}
  >
    {node.children.map((child, i) => (
      <Fragment key={child.id}>
        {i > 0 && <ResizableHandle />}
        <ResizablePanel id={`pane-${child.id}`} minSize="10%">
          <PaneTreeView
            node={child}
            tabVisible={tabVisible}
            activeLeafId={activeLeafId}
            onFocusLeaf={onFocusLeaf}
            getBundle={getBundle}
          />
        </ResizablePanel>
      </Fragment>
    ))}
  </ResizablePanelGroup>
);
```

to:

```tsx
return (
  <ResizablePanelGroup
    orientation={node.dir === "row" ? "horizontal" : "vertical"}
    onLayout={(sizes) => onResizeSplit(node.id, sizes)}
  >
    {node.children.map((child, i) => (
      <Fragment key={child.id}>
        {i > 0 && <ResizableHandle />}
        <ResizablePanel
          id={`pane-${child.id}`}
          minSize={10}
          defaultSize={node.sizes?.[i]}
        >
          <PaneTreeView
            node={child}
            tabVisible={tabVisible}
            activeLeafId={activeLeafId}
            onFocusLeaf={onFocusLeaf}
            getBundle={getBundle}
            onResizeSplit={onResizeSplit}
          />
        </ResizablePanel>
      </Fragment>
    ))}
  </ResizablePanelGroup>
);
```

Notes:
- `minSize="10%"` was a string, but `react-resizable-panels` uses numeric percentages (`minSize={10}` = 10%). Verify against the installed version's typings; if the original string form was correct for this version, keep it as `"10%"` — don't change behavior. Update `defaultSize` to match (string or number per the same convention).
- `onLayout` fires on the *outer* `ResizablePanelGroup` only, with sizes for its direct children. Nested splits each fire their own `onLayout`. This matches our per-split storage model.

- [ ] **Step 3: Thread `onResizeSplit` through `TerminalStack`**

Open `src/modules/terminal/TerminalStack.tsx`, find where it renders `<PaneTreeView ...>` (around line 94), and add an `onResizeSplit` prop on the `<PaneTreeView>` element. Add an `onResizeSplit?: (splitId: number, sizes: number[]) => void` prop to `TerminalStack`'s own Props type, and pass it through.

- [ ] **Step 4: Wire `setSplitSizes` from `App.tsx`**

In `src/app/App.tsx`, locate the `<TerminalStack>` render (search for `TerminalStack`). Add an `onResizeSplit` prop that calls the `setSplitSizes` from `useTabs`, scoped to the currently-active terminal tab.

The cleanest way: pull `setSplitSizes` out of the `useTabs` destructure (added in Task 4 step 3) into a wrapper that captures the tab id:

```tsx
const onResizeSplit = useCallback(
  (splitId: number, sizes: number[]) => {
    // setSplitSizes already finds the right tab by walking; pass the active id.
    setSplitSizes(activeId, splitId, sizes);
  },
  [setSplitSizes, activeId],
);
```

Then `<TerminalStack onResizeSplit={onResizeSplit} ... />`.

(`useCallback` should already be imported. If `setSplitSizes` and `activeId` are not yet destructured from `useTabs`, add them.)

- [ ] **Step 5: Verify build**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Step 6: Manual smoke (recommended)**

```bash
pnpm tauri dev
```

Open a terminal tab, split it, drag the divider. Quit and relaunch. The split should reopen at the same ratio. (This step is the "did I wire it correctly" check — if it doesn't work, the bug is in `onLayout`'s signature mismatch or in the `defaultSize` prop type. Skip if you'd rather batch all manual smoke at the end.)

- [ ] **Step 7: Commit**

```bash
git add src/modules/terminal/PaneTreeView.tsx src/modules/terminal/TerminalStack.tsx src/app/App.tsx
git commit -m "feat(terminal): persist split-pane ratios across sessions"
```

---

## Task 10: Wire load + render gate in `App.tsx`

**Files:**
- Modify: `src/app/App.tsx`

`App.tsx` currently calls `useTabs(getLaunchDir() ? { cwd: getLaunchDir() } : undefined)` at line ~191. We now:

1. Derive the session key from launch dir + workspace env.
2. Read `restoreSession` from prefs.
3. If `restoreSession` is true: gate the first render until `loadSession` resolves, then pass the restored payload (or null) into `useTabs`.
4. If `restoreSession` is false: skip the load, pass through the legacy `{cwd}` form.

This is the trickiest part of the plan because `useTabs` must be called unconditionally (rules of hooks) — so the load is done in a small wrapper hook that resolves to either `{ kind: "loading" }`, `{ kind: "ready", restored: RestoredInitial | null }`.

- [ ] **Step 1: Add the wrapper hook**

Create a new file: `src/modules/tabs/lib/useSessionLoad.ts`

```ts
import { useEffect, useRef, useState } from "react";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { currentWorkspaceScopeKey } from "@/modules/workspace";
import { loadSession } from "./sessionPersistence";
import type { RestoredInitial } from "./sessionDeserialize";
import { sessionKey } from "./sessionKey";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; restored: RestoredInitial | null; key: string };

const RESTORE_START_ID = 1_000_000; // sentinel to avoid clashing with default ids

/**
 * Loads the saved session (if any) once on mount. Returns "loading" until the
 * read resolves; "ready" thereafter. Callers gate their first useTabs() call
 * on this so the default tab doesn't clobber the restored payload.
 *
 * Reads launchDir / workspaceScope once at mount — switching env after mount
 * does NOT trigger a re-load (we keep the session in place and persist to the
 * new key on next write; see the persistence effect).
 */
export function useSessionLoad(launchDir: string | undefined): LoadState {
  const restoreSession = usePreferencesStore((s) => s.restoreSession);
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (!hydrated) return; // wait for prefs to populate restoreSession
    startedRef.current = true;

    const key = sessionKey(launchDir, currentWorkspaceScopeKey());
    if (!restoreSession) {
      setState({ kind: "ready", restored: null, key });
      return;
    }
    void loadSession(key, RESTORE_START_ID).then((restored) => {
      setState({ kind: "ready", restored, key });
    });
  }, [hydrated, restoreSession, launchDir]);

  return state;
}
```

- [ ] **Step 2: Export the helper from the tabs index**

Open `src/modules/tabs/index.ts` (read it first to find the right export style) and re-export `useSessionLoad` and `sessionKey`:

```ts
export { useSessionLoad } from "./lib/useSessionLoad";
export { sessionKey } from "./lib/sessionKey";
```

Also export the deserializer's `RestoredInitial` type so App.tsx can reference it via the tabs module.

- [ ] **Step 3: Use the loader in `App.tsx`**

At the top of `src/app/App.tsx`, add the import (merging with the existing tabs import):

```tsx
import { MAX_PANES_PER_TAB, useSessionLoad, useTabs, useWorkspaceCwd } from "@/modules/tabs";
```

Then find the current `useTabs` invocation (around line 191):

```tsx
const {
  // ... destructure
} = useTabs(getLaunchDir() ? { cwd: getLaunchDir() } : undefined);
```

Replace it with:

```tsx
const launchDir = getLaunchDir();
const sessionLoad = useSessionLoad(launchDir);

const tabsInit =
  sessionLoad.kind === "ready"
    ? sessionLoad.restored
      ? { restored: sessionLoad.restored }
      : launchDir
        ? { cwd: launchDir }
        : undefined
    : undefined;

const {
  // ... destructure (unchanged)
} = useTabs(tabsInit);
```

- [ ] **Step 4: Add the render gate**

Locate the early-return section of `App.tsx` (the existing guard that returns null/splash before all hooks finish initializing — search for `return null` or for a similar gate). Add a session-load gate alongside it. If no such gate exists yet (the existing code may render the default tree always), add one:

```tsx
// Gate first paint until session load resolves so we don't flash the
// default tab before the restored payload arrives.
if (sessionLoad.kind === "loading") {
  return null;
}
```

This goes after all `useTabs` and related hooks have been called (rules of hooks: gate after hook calls, not before).

- [ ] **Step 5: Verify build**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/modules/tabs/lib/useSessionLoad.ts src/modules/tabs/index.ts src/app/App.tsx
git commit -m "feat(app): gate startup on session load and pass restored payload to useTabs"
```

---

## Task 11: Wire the persistence effect

**Files:**
- Modify: `src/app/App.tsx`

Debounced save on every `tabs`/`activeId`/`sessionKey` change.

- [ ] **Step 1: Add the imports**

In `src/app/App.tsx`, add:

```tsx
import { saveSession } from "@/modules/tabs/lib/sessionPersistence";
import { serializeSession } from "@/modules/tabs/lib/sessionSerialize";
import { currentWorkspaceScopeKey } from "@/modules/workspace";
```

(merge with existing imports as appropriate.)

- [ ] **Step 2: Compute the live session key**

Inside the App component, after `sessionLoad` is in scope:

```tsx
const workspaceEnv = useWorkspaceEnvStore((s) => s.env);
const liveSessionKey =
  sessionLoad.kind === "ready" ? sessionLoad.key : null;

// If the workspace env changes after mount, recompute the key so subsequent
// writes go to the new bucket. The initial key is captured at mount inside
// useSessionLoad; this effect handles the post-mount transition.
const currentKey = useMemo(() => {
  if (sessionLoad.kind !== "ready") return null;
  // Match sessionKey() format exactly.
  const base = launchDir && launchDir.length > 0 ? launchDir : "default";
  const env = workspaceEnv.kind === "wsl" ? `wsl:${workspaceEnv.distro}` : "local";
  return `${base}::${env}`;
}, [sessionLoad.kind, launchDir, workspaceEnv]);
```

(Add `useMemo` to the React imports if not already imported.)

- [ ] **Step 3: Add the debounced persistence effect**

After the existing `useTabs` destructure and `currentKey` derivation, add:

```tsx
const restoreSessionPref = usePreferencesStore((s) => s.restoreSession);

useEffect(() => {
  if (!restoreSessionPref) return;
  if (sessionLoad.kind !== "ready") return;
  if (!currentKey) return;
  const t = setTimeout(() => {
    void saveSession(currentKey, serializeSession(tabs, activeId));
  }, 300);
  return () => clearTimeout(t);
}, [tabs, activeId, currentKey, restoreSessionPref, sessionLoad.kind]);
```

(`tabs` and `activeId` are already in scope from the `useTabs` destructure. If they're named differently in the destructure, use the actual names.)

- [ ] **Step 4: Verify build**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Step 5: Manual smoke (optional, requires running app)**

If you want to confirm the persistence wiring before moving on:

```bash
pnpm tauri dev
```

Open a new tab, close the window, relaunch. The new tab should reappear.

Skip this step if you'd rather batch all manual smoke at the end (Task 13).

- [ ] **Step 6: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat(app): persist tab session on every change (debounced)"
```

---

## Task 12: Clear-on-toggle-off

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/settings/sections/GeneralSection.tsx`

When the user toggles `restoreSession` from ON → OFF, clear the current session entry so the next launch is clean.

The settings UI lives in a separate webview from `App.tsx`. Using the `onPreferencesChange` cross-window event (already in `store.ts`), `App.tsx` listens for the change and calls `clearSession(currentKey)`.

- [ ] **Step 1: Add the import**

In `src/app/App.tsx`:

```tsx
import { clearSession } from "@/modules/tabs/lib/sessionPersistence";
```

- [ ] **Step 2: Add the clear effect**

After the persistence effect, add:

```tsx
const prevRestorePrefRef = useRef(restoreSessionPref);
useEffect(() => {
  const prev = prevRestorePrefRef.current;
  prevRestorePrefRef.current = restoreSessionPref;
  if (prev && !restoreSessionPref && currentKey) {
    void clearSession(currentKey);
  }
}, [restoreSessionPref, currentKey]);
```

(Add `useRef` to the React imports if not already imported.)

- [ ] **Step 3: Verify build**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat(app): clear stored session when 'Restore previous session' is turned off"
```

---

## Task 13: Final smoke + cleanup

**Files:** none — manual.

- [ ] **Step 1: Run all tests**

Run: `pnpm test`
Expected: all tests pass (including the new sessionKey/sessionSerialize/sessionDeserialize tests).

- [ ] **Step 2: Run the build**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Step 3: Manual smoke — happy path**

Run: `pnpm tauri dev`

In a launched window:
1. Open a couple of terminal tabs, split one into two panes, `cd` each pane to a different directory.
2. Open a couple of source files (preview-tab-style by single-click in the explorer, then double-click to pin one).
3. Open a markdown preview.
4. Quit Terax.
5. Relaunch. Confirm: terminals reopen with their cwds, the pinned editor reopens, the markdown reopens, the active tab matches, the *preview* editor is gone.

- [ ] **Step 4: Manual smoke — toggle off**

1. In Settings → General, toggle "Restore previous session" OFF.
2. Quit, relaunch. Confirm: fresh terminal tab, no restored content.
3. Toggle ON again, open some tabs, quit, relaunch. Confirm: restored.

- [ ] **Step 5: Manual smoke — missing file**

1. Open an editor on a temp file (e.g. `/tmp/foo.txt`). Make sure it has content.
2. Quit Terax.
3. Delete `/tmp/foo.txt` from the OS.
4. Relaunch. Confirm: the tab reopens but renders the existing error banner ("ENOENT"-style); Terax does not crash.

- [ ] **Step 6: Manual smoke — distinct launch dirs**

1. Launch Terax CLI in `~/projects/foo` (`pnpm tauri dev` if you can pass a launch dir, otherwise close + reopen the binary with the right CWD). Open a tab. Quit.
2. Launch in `~/projects/bar`. Confirm: empty session (foo's tabs do NOT appear).
3. Launch in `~/projects/foo` again. Confirm: foo's tabs come back.

- [ ] **Step 7: Commit if any smoke-test tweaks were needed**

If you discovered a bug or had to adjust:

```bash
git add -A
git commit -m "fix(session): smoke-test adjustments"
```

If everything worked, skip this commit.

---

## Self-review

After writing this plan, checked against the spec:

**Spec coverage:**
- §1 Keying & storage → Tasks 3, 7, 10 (sessionKey helper, LazyStore-backed persistence, App-side derivation).
- §2 Schema → Tasks 4, 5, 6 (PaneNode extension, serialize, deserialize).
- §2 Runtime PaneNode extension → Tasks 4 (type + mutation) and 9 (render-side `onLayout` + `defaultSize`).
- §3 Save and restore flow → Tasks 7, 8, 10, 11 (persistence module, useTabs initializer, App-side gate, debounced effect).
- §4 Settings UI → Tasks 1, 2 (pref + toggle).
- §5 Edge cases → covered inline: schema mismatch (Task 6), pruning (Task 7), missing files (no code needed, existing useDocument behavior), env switch (Task 11), active-tab fallback (Task 6), size-shape mismatch defensive drop (Task 6).
- §6 Out of scope → confirmed; no tasks for those items.

**Placeholders:** scanned, none present.

**Type consistency:** `SerializedTab`/`SerializedPaneNode`/`SessionV1` defined in Task 5's `sessionSchema.ts` and consumed identically in Tasks 6, 7. `RestoredInitial` defined in Task 6, consumed in Task 8. `sessionKey` signature `(launchDir | undefined, workspaceScope) => string` consistent between Task 3 and Task 10. `PaneNode.sizes` field defined in Task 4, serialized in Task 5, deserialized in Task 6, consumed in Task 9. `setSplitSizes(tabId, splitId, sizes)` signature in Task 4 matches the caller in Task 9.

**Open risks for the implementer:**
1. The `useSessionLoad` hook in Task 10 reads `usePreferencesStore((s) => s.hydrated)` — confirm this field exists in the preferences store (it should, based on the brainstorming exploration; if not, the load gate may need to wait differently).
2. Task 10 step 4's render-gate placement depends on the actual structure of `App.tsx`'s current early-return logic. Read the file's top-level structure before placing the gate.
3. The `setRestoreSession` setter call in Task 2 uses `onCheckedChange` from a `Switch` component — confirm the exact prop name by reading the existing `restoreWindowState` toggle. If it's `onCheckedChange` for shadcn-style switches and `onChange` for raw checkbox/HTML, match the existing pattern.
4. Task 9 step 2's `minSize` prop type (string `"10%"` vs number `10`) depends on the installed `react-resizable-panels` version. Read the current `PaneTreeView.tsx` and keep whatever form is already there. The new `defaultSize` prop must use the same convention.
5. Task 9 step 3 requires reading `TerminalStack.tsx` to thread `onResizeSplit` through — the existing prop list may need a new field added.
