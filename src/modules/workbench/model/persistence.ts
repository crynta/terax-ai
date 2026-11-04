import {
  basename,
  type EditorTab,
  type MarkdownTab,
  type PreviewTab,
  type Tab,
  type TerminalTab,
  titleFromUrl,
} from "@/modules/tabs/lib/tabs";
import {
  card,
  cards,
  type LayoutNode,
  normalizeRatios,
  removeCard,
  type SplitDir,
  split,
  updateCard,
} from "./layout";
import {
  type Alloc,
  activeTask,
  type Task,
  type TaskKind,
  tabById,
  type WorkbenchState,
} from "./workbench";

export const WORKBENCH_VERSION = 1;

type SerializedTab =
  | { kind: "terminal"; cwd?: string; blocks?: true; customTitle?: string }
  | { kind: "editor"; path: string }
  | { kind: "preview"; url: string }
  | { kind: "markdown"; path: string };

type SerializedLayout =
  | { kind: "card"; tabs: SerializedTab[]; active: number }
  | {
      kind: "split";
      dir: SplitDir;
      ratios: number[];
      children: SerializedLayout[];
    };

type SerializedTask = {
  kind: TaskKind;
  name?: string;
  cwd?: string;
  branch?: string;
  createdAt: number;
  layout: SerializedLayout;
  /** Index of the focused card in layout order. */
  focused: number;
};

export type ProjectState = {
  version: typeof WORKBENCH_VERSION;
  tasks: SerializedTask[];
  activeTask: number;
  /**
   * Fingerprint of the legacy (pre-workbench) entry this state was last
   * reconciled with. A different legacy entry on disk means an older build
   * wrote it after this state, so it is migrated again.
   */
  legacy?: string;
};

export type HydratedProject = {
  tabs: Tab[];
  tasks: Task[];
  activeTaskId: number | null;
  /** Saved tasks or tabs that could not be read (the blob is then backed up). */
  dropped: number;
};

/** A stable, compact hash of a JSON value (FNV-1a over its serialization). */
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value) ?? "";
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Whether `raw` is a project state this build can read. */
function isKnownProjectState(raw: unknown): boolean {
  return isRecord(raw) && raw.version === WORKBENCH_VERSION;
}

function serializeTab(tab: Tab): SerializedTab | null {
  switch (tab.kind) {
    case "terminal":
      if (tab.private) return null;
      return {
        kind: "terminal",
        ...(tab.cwd && { cwd: tab.cwd }),
        ...(tab.blocks && { blocks: true as const }),
        ...(tab.customTitle && { customTitle: tab.customTitle }),
      };
    case "editor":
      return { kind: "editor", path: tab.path };
    case "preview":
      return { kind: "preview", url: tab.url };
    case "markdown":
      return { kind: "markdown", path: tab.path };
    default:
      return null;
  }
}

/** The task's layout with unsaved tabs (private, diffs, history) pruned out. */
function persistableLayout(
  state: WorkbenchState,
  task: Task,
): { layout: LayoutNode; serialized: Map<number, SerializedTab> } | null {
  const serialized = new Map<number, SerializedTab>();
  let layout: LayoutNode | null = task.layout;
  for (const c of cards(task.layout)) {
    const kept = c.tabIds.filter((id) => {
      const tab = tabById(state, id);
      const s = tab && serializeTab(tab);
      if (s) serialized.set(id, s);
      return !!s;
    });
    if (!layout) break;
    if (kept.length === 0) layout = removeCard(layout, c.id);
    else if (kept.length !== c.tabIds.length)
      layout = updateCard(layout, c.id, (old) => ({
        ...old,
        tabIds: kept,
        activeTabId: kept.includes(old.activeTabId) ? old.activeTabId : kept[0],
      }));
  }
  return layout ? { layout, serialized } : null;
}

function serializeLayout(
  node: LayoutNode,
  tabs: ReadonlyMap<number, SerializedTab>,
): SerializedLayout {
  if (node.kind === "card") {
    const list = node.tabIds.flatMap((id) => {
      const s = tabs.get(id);
      return s ? [s] : [];
    });
    const active = node.tabIds.indexOf(node.activeTabId);
    return { kind: "card", tabs: list, active: Math.max(0, active) };
  }
  return {
    kind: "split",
    dir: node.dir,
    ratios: node.ratios.map((r) => Math.round(r * 1e4) / 1e4),
    children: node.children.map((c) => serializeLayout(c, tabs)),
  };
}

export function serializeProject(
  state: WorkbenchState,
  projectId: string,
  legacy?: string,
): ProjectState {
  const active = activeTask(state, projectId);
  const out: SerializedTask[] = [];
  let activeIndex = 0;
  for (const task of state.tasks) {
    if (task.projectId !== projectId) continue;
    const pruned = persistableLayout(state, task);
    let layout: SerializedLayout;
    let focused = 0;
    if (pruned) {
      layout = serializeLayout(pruned.layout, pruned.serialized);
      focused = Math.max(
        0,
        cards(pruned.layout).findIndex((c) => c.id === task.focusedCardId),
      );
    } else if (task.kind === "main") {
      layout = {
        kind: "card",
        tabs: [{ kind: "terminal", ...(task.cwd && { cwd: task.cwd }) }],
        active: 0,
      };
    } else continue;
    if (task === active) activeIndex = out.length;
    out.push({
      kind: task.kind,
      ...(task.name && { name: task.name }),
      ...(task.cwd && { cwd: task.cwd }),
      ...(task.branch && { branch: task.branch }),
      createdAt: task.createdAt,
      layout,
      focused,
    });
  }
  return {
    version: WORKBENCH_VERSION,
    tasks: out,
    activeTask: activeIndex,
    ...(legacy && { legacy }),
  };
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

export function hydrateTab(
  raw: unknown,
  projectId: string,
  alloc: Alloc,
): Tab | null {
  if (!isRecord(raw)) return null;
  const base = { id: alloc(), spaceId: projectId, cold: true };
  switch (raw.kind) {
    case "terminal": {
      const cwd = str(raw.cwd);
      const customTitle = str(raw.customTitle);
      const tab: TerminalTab = {
        ...base,
        kind: "terminal",
        title:
          customTitle ??
          (cwd ? basename(cwd) : raw.blocks ? "blocks" : "shell"),
      };
      if (cwd) tab.cwd = cwd;
      if (raw.blocks === true) tab.blocks = true;
      if (customTitle) tab.customTitle = customTitle;
      return tab;
    }
    case "editor": {
      const path = str(raw.path);
      if (!path) return null;
      return {
        ...base,
        kind: "editor",
        title: basename(path),
        path,
        dirty: false,
        preview: false,
      } satisfies EditorTab;
    }
    case "preview": {
      const url = typeof raw.url === "string" ? raw.url : "";
      return {
        ...base,
        kind: "preview",
        title: titleFromUrl(url),
        url,
      } satisfies PreviewTab;
    }
    case "markdown": {
      const path = str(raw.path);
      if (!path) return null;
      return {
        ...base,
        kind: "markdown",
        title: basename(path),
        path,
      } satisfies MarkdownTab;
    }
    default:
      return null;
  }
}

function hydrateLayout(
  raw: unknown,
  projectId: string,
  alloc: Alloc,
  tabs: Tab[],
  loss: { dropped: number },
  depth = 0,
): LayoutNode | null {
  if (!isRecord(raw) || depth > 32) {
    loss.dropped += 1;
    return null;
  }
  if (raw.kind === "card") {
    const list = Array.isArray(raw.tabs) ? raw.tabs : [];
    const ids: number[] = [];
    let activeTabId: number | undefined;
    list.forEach((entry, i) => {
      const tab = hydrateTab(entry, projectId, alloc);
      if (!tab) {
        loss.dropped += 1;
        return;
      }
      tabs.push(tab);
      ids.push(tab.id);
      if (i === raw.active) activeTabId = tab.id;
    });
    if (ids.length === 0) {
      loss.dropped += 1;
      return null;
    }
    return card(alloc(), ids, activeTabId ?? ids[0]);
  }
  if (raw.kind === "split" && (raw.dir === "row" || raw.dir === "col")) {
    const rawChildren = Array.isArray(raw.children) ? raw.children : [];
    const rawRatios = Array.isArray(raw.ratios) ? raw.ratios : [];
    const children: LayoutNode[] = [];
    const ratios: number[] = [];
    rawChildren.forEach((child, i) => {
      const node = hydrateLayout(
        child,
        projectId,
        alloc,
        tabs,
        loss,
        depth + 1,
      );
      if (!node) return;
      children.push(node);
      const r = rawRatios[i];
      ratios.push(typeof r === "number" && r > 0 ? r : 1);
    });
    if (children.length === 0) {
      loss.dropped += 1;
      return null;
    }
    if (children.length === 1) return children[0];
    return split(alloc(), raw.dir, children, normalizeRatios(ratios));
  }
  // An unknown node kind or split direction: unreadable, so it is a loss.
  loss.dropped += 1;
  return null;
}

const TASK_KINDS: readonly TaskKind[] = ["main", "local", "worktree"];

function hydrateTask(
  raw: unknown,
  projectId: string,
  alloc: Alloc,
  loss: { dropped: number },
): { task: Task; tabs: Tab[] } | null {
  if (!isRecord(raw)) {
    loss.dropped += 1;
    return null;
  }
  const tabs: Tab[] = [];
  const layout = hydrateLayout(raw.layout, projectId, alloc, tabs, loss);
  if (!layout) return null;
  const all = cards(layout);
  const focused =
    typeof raw.focused === "number" && all[raw.focused]
      ? all[raw.focused].id
      : all[0].id;
  const kind = TASK_KINDS.includes(raw.kind as TaskKind)
    ? (raw.kind as TaskKind)
    : "local";
  const task: Task = {
    id: alloc(),
    projectId,
    kind,
    ...(str(raw.name) && { name: str(raw.name) }),
    ...(str(raw.cwd) && { cwd: str(raw.cwd) }),
    ...(str(raw.branch) && { branch: str(raw.branch) }),
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    layout,
    focusedCardId: focused,
    maximizedCardId: null,
  };
  return { task, tabs };
}

/** Exactly one main task, first in the strip. */
function withSingleMain(tasks: Task[]): Task[] {
  if (tasks.length === 0) return tasks;
  const mainIndex = Math.max(
    0,
    tasks.findIndex((t) => t.kind === "main"),
  );
  return [
    { ...tasks[mainIndex], kind: "main" as const },
    ...tasks
      .filter((_, i) => i !== mainIndex)
      .map((t) => (t.kind === "main" ? { ...t, kind: "local" as const } : t)),
  ];
}

export function hydrateProject(
  raw: unknown,
  projectId: string,
  alloc: Alloc,
): HydratedProject {
  if (!isRecord(raw) || raw.version !== WORKBENCH_VERSION)
    return { tabs: [], tasks: [], activeTaskId: null, dropped: 0 };
  const list = Array.isArray(raw.tasks) ? raw.tasks : [];
  const tabs: Tab[] = [];
  const tasks: Task[] = [];
  const loss = { dropped: 0 };
  let activeTaskId: number | null = null;
  list.forEach((entry, i) => {
    const hydrated = hydrateTask(entry, projectId, alloc, loss);
    if (!hydrated) return;
    tabs.push(...hydrated.tabs);
    tasks.push(hydrated.task);
    if (i === raw.activeTask) activeTaskId = hydrated.task.id;
  });
  const ordered = withSingleMain(tasks);
  return {
    tabs,
    tasks: ordered,
    activeTaskId: activeTaskId ?? ordered[0]?.id ?? null,
    dropped: loss.dropped,
  };
}

export type ProjectSource = {
  /** Where the project's tasks come from. */
  from: "workbench" | "legacy" | "none";
  /** The stored workbench blob will be replaced while unread: back it up. */
  backup: boolean;
};

/**
 * Decides how a project restores. Its workbench state wins while it was
 * reconciled with the legacy entry now on disk; a legacy entry it has not
 * seen (written by an older build after a downgrade) is migrated again. A
 * blob this build cannot read is never discarded silently.
 */
export function projectSource(
  workbenchRaw: unknown,
  legacyRaw: unknown,
): ProjectSource {
  const stored = workbenchRaw !== undefined;
  const known = isKnownProjectState(workbenchRaw);
  if (legacyRaw === undefined)
    return known
      ? { from: "workbench", backup: false }
      : { from: "none", backup: stored };
  const seen =
    known && (workbenchRaw as ProjectState).legacy === fingerprint(legacyRaw);
  return seen
    ? { from: "workbench", backup: false }
    : { from: "legacy", backup: stored };
}
