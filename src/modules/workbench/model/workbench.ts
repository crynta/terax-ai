import {
  basename,
  isPreviewTab,
  patchTab,
  type Tab,
  type TabPatch,
} from "@/modules/tabs/lib/tabs";
import {
  card,
  cardIds,
  cards,
  computeFrames,
  cycleCard,
  type Direction,
  findCard,
  insertCardBeside,
  type LayoutNode,
  neighborCard,
  removeCard,
  type SplitDir,
  setSplitRatios,
  swapCardContents,
  tabIdsOf,
  updateCard,
} from "./layout";

export type TaskKind = "main" | "local" | "worktree";

export type Task = {
  readonly id: number;
  readonly projectId: string;
  readonly kind: TaskKind;
  /** User-set name; unset follows the focused tab's label. */
  readonly name?: string;
  /** Directory new terminals in this task start in. */
  readonly cwd?: string;
  readonly branch?: string;
  readonly createdAt: number;
  readonly layout: LayoutNode;
  readonly focusedCardId: number;
  readonly maximizedCardId: number | null;
};

export type WorkbenchState = {
  readonly tabs: Tab[];
  /** Ordered; a project's tasks appear in this order in its strip. */
  readonly tasks: Task[];
  readonly activeProjectId: string;
  readonly activeTaskByProject: Readonly<Record<string, number>>;
};

export type Alloc = () => number;

export type TabLocation = { readonly task: Task; readonly cardId: number };

export const EMPTY_WORKBENCH: WorkbenchState = {
  tabs: [],
  tasks: [],
  activeProjectId: "",
  activeTaskByProject: {},
};

const locationIndex = new WeakMap<
  readonly Task[],
  Map<number, { taskIndex: number; cardId: number }>
>();

function indexOf(tasks: readonly Task[]) {
  let index = locationIndex.get(tasks);
  if (index) return index;
  index = new Map();
  tasks.forEach((task, taskIndex) => {
    for (const c of cards(task.layout))
      for (const tabId of c.tabIds)
        index?.set(tabId, { taskIndex, cardId: c.id });
  });
  locationIndex.set(tasks, index);
  return index;
}

export function locateTab(
  state: Pick<WorkbenchState, "tasks">,
  tabId: number,
): TabLocation | null {
  const hit = indexOf(state.tasks).get(tabId);
  if (!hit) return null;
  return { task: state.tasks[hit.taskIndex], cardId: hit.cardId };
}

export function taskById(
  state: Pick<WorkbenchState, "tasks">,
  id: number,
): Task | undefined {
  return state.tasks.find((t) => t.id === id);
}

export function tabById(
  state: Pick<WorkbenchState, "tabs">,
  id: number,
): Tab | undefined {
  return state.tabs.find((t) => t.id === id);
}

export function projectTasks(
  state: Pick<WorkbenchState, "tasks">,
  projectId: string,
): Task[] {
  return state.tasks.filter((t) => t.projectId === projectId);
}

export function activeTask(
  state: WorkbenchState,
  projectId = state.activeProjectId,
): Task | undefined {
  const id = state.activeTaskByProject[projectId];
  const task = id === undefined ? undefined : taskById(state, id);
  return task ?? state.tasks.find((t) => t.projectId === projectId);
}

export function focusedTabId(task: Task): number {
  const focused =
    findCard(task.layout, task.focusedCardId) ?? cards(task.layout)[0];
  return focused.activeTabId;
}

/** The tab with keyboard focus: the focused card's tab in the active task. */
export function activeTabId(state: WorkbenchState): number | null {
  const task = activeTask(state);
  return task ? focusedTabId(task) : null;
}

/** Tabs currently on screen: each card's tab in the active task. */
export function visibleTabIds(state: WorkbenchState): Set<number> {
  const task = activeTask(state);
  const out = new Set<number>();
  if (!task) return out;
  for (const c of cards(task.layout)) {
    if (task.maximizedCardId !== null && c.id !== task.maximizedCardId)
      continue;
    out.add(c.activeTabId);
  }
  return out;
}

function taskTabs(state: WorkbenchState, task: Task): Tab[] {
  const ids = new Set(tabIdsOf(task.layout));
  return state.tabs.filter((t) => ids.has(t.id));
}

function replaceTask(state: WorkbenchState, next: Task): WorkbenchState {
  return {
    ...state,
    tasks: state.tasks.map((t) => (t.id === next.id ? next : t)),
  };
}

function withActive(state: WorkbenchState, task: Task): WorkbenchState {
  if (
    state.activeProjectId === task.projectId &&
    state.activeTaskByProject[task.projectId] === task.id
  )
    return state;
  return {
    ...state,
    activeProjectId: task.projectId,
    activeTaskByProject: {
      ...state.activeTaskByProject,
      [task.projectId]: task.id,
    },
  };
}

/** Marks every on-screen tab warm, so restored tabs mount when first shown. */
export function warmVisible(state: WorkbenchState): WorkbenchState {
  const visible = visibleTabIds(state);
  if (!state.tabs.some((t) => t.cold && visible.has(t.id))) return state;
  return {
    ...state,
    tabs: state.tabs.map((t) =>
      t.cold && visible.has(t.id) ? { ...t, cold: false } : t,
    ),
  };
}

export function activateTab(
  state: WorkbenchState,
  tabId: number,
): WorkbenchState {
  const loc = locateTab(state, tabId);
  if (!loc) return state;
  const { task, cardId } = loc;
  const layout = updateCard(task.layout, cardId, (c) =>
    c.activeTabId === tabId ? c : { ...c, activeTabId: tabId },
  );
  const maximizedCardId =
    task.maximizedCardId !== null && task.maximizedCardId !== cardId
      ? null
      : task.maximizedCardId;
  const next =
    layout === task.layout &&
    task.focusedCardId === cardId &&
    maximizedCardId === task.maximizedCardId
      ? task
      : { ...task, layout, focusedCardId: cardId, maximizedCardId };
  return withActive(next === task ? state : replaceTask(state, next), next);
}

export function activateTask(
  state: WorkbenchState,
  taskId: number,
): WorkbenchState {
  const task = taskById(state, taskId);
  return task ? withActive(state, task) : state;
}

export function focusCard(
  state: WorkbenchState,
  taskId: number,
  cardId: number,
): WorkbenchState {
  const task = taskById(state, taskId);
  const target = task && findCard(task.layout, cardId);
  if (!task || !target) return state;
  return activateTab(state, target.activeTabId);
}

export function selectProject(
  state: WorkbenchState,
  projectId: string,
): WorkbenchState {
  return state.activeProjectId === projectId
    ? state
    : { ...state, activeProjectId: projectId };
}

export type NewTask = {
  projectId: string;
  kind: TaskKind;
  name?: string;
  cwd?: string;
  branch?: string;
};

export function addTask(
  state: WorkbenchState,
  input: NewTask,
  tabs: readonly Tab[],
  layout: LayoutNode,
  focusedCardId: number,
  alloc: Alloc,
  options: { activate?: boolean; createdAt?: number } = {},
): { state: WorkbenchState; task: Task } {
  const task: Task = {
    id: alloc(),
    projectId: input.projectId,
    kind: input.kind,
    ...(input.name && { name: input.name }),
    ...(input.cwd && { cwd: input.cwd }),
    ...(input.branch && { branch: input.branch }),
    createdAt: options.createdAt ?? Date.now(),
    layout,
    focusedCardId,
    maximizedCardId: null,
  };
  let next: WorkbenchState = {
    ...state,
    tabs: [...state.tabs, ...tabs],
    tasks: [...state.tasks, task],
  };
  if (options.activate ?? true) next = withActive(next, task);
  else if (state.activeTaskByProject[task.projectId] === undefined)
    next = {
      ...next,
      activeTaskByProject: {
        ...next.activeTaskByProject,
        [task.projectId]: task.id,
      },
    };
  return { state: next, task };
}

/** A task holding one card with `tab`. */
export function addSingleTabTask(
  state: WorkbenchState,
  input: NewTask,
  tab: Tab,
  alloc: Alloc,
  options?: { activate?: boolean },
): { state: WorkbenchState; task: Task } {
  const cardId = alloc();
  return addTask(
    state,
    input,
    [tab],
    card(cardId, [tab.id]),
    cardId,
    alloc,
    options,
  );
}

export type Placement =
  | { kind: "stack"; cardId: number; index?: number }
  | { kind: "split"; cardId: number; dir: SplitDir; side?: "before" | "after" };

/** Adds a new tab to a task and focuses it. */
export function addTab(
  state: WorkbenchState,
  taskId: number,
  tab: Tab,
  placement: Placement,
  alloc: Alloc,
  options: { activate?: boolean } = {},
): WorkbenchState {
  const task = taskById(state, taskId);
  if (!task || !findCard(task.layout, placement.cardId)) return state;
  let layout: LayoutNode;
  let cardId = placement.cardId;
  if (placement.kind === "stack") {
    layout = updateCard(task.layout, placement.cardId, (c) => {
      const tabIds = [...c.tabIds];
      const at =
        placement.index === undefined
          ? tabIds.indexOf(c.activeTabId) + 1
          : Math.max(0, Math.min(placement.index, tabIds.length));
      tabIds.splice(at, 0, tab.id);
      return { ...c, tabIds };
    });
  } else {
    cardId = alloc();
    layout = insertCardBeside(
      task.layout,
      placement.cardId,
      card(cardId, [tab.id]),
      placement.dir,
      placement.side ?? "after",
      alloc,
    );
  }
  const next = replaceTask(
    { ...state, tabs: [...state.tabs, tab] },
    { ...task, layout },
  );
  return options.activate === false ? next : activateTab(next, tab.id);
}

/** Where a document (anything but a terminal) opens in a task. */
export function documentPlacement(
  state: WorkbenchState,
  task: Task,
): Placement {
  const isDocumentCard = (id: number) => {
    const c = findCard(task.layout, id);
    const tab = c ? tabById(state, c.activeTabId) : undefined;
    return tab !== undefined && tab.kind !== "terminal";
  };
  if (isDocumentCard(task.focusedCardId))
    return { kind: "stack", cardId: task.focusedCardId };
  const other = cardIds(task.layout).find(isDocumentCard);
  if (other !== undefined) return { kind: "stack", cardId: other };
  return { kind: "split", cardId: task.focusedCardId, dir: "row" };
}

/**
 * Opens `tab` as a document in a task: reuses an existing tab matched by
 * `matches` (activating it, optionally patched by `refresh`), replaces the
 * target card's preview slot when `tab` is itself a preview, else adds it.
 */
export function openDocument(
  state: WorkbenchState,
  taskId: number,
  tab: Tab,
  matches: (candidate: Tab) => boolean,
  alloc: Alloc,
  options: {
    refresh?: (existing: Tab) => Tab;
    activate?: boolean;
  } = {},
): { state: WorkbenchState; tabId: number } {
  const task = taskById(state, taskId);
  if (!task) return { state, tabId: tab.id };
  const own = taskTabs(state, task).filter(matches);
  const existing = own.find((t) => !isPreviewTab(t)) ?? own[0];
  const activate = options.activate ?? true;
  if (existing) {
    const refreshed = options.refresh?.(existing) ?? existing;
    let next =
      refreshed === existing
        ? state
        : {
            ...state,
            tabs: state.tabs.map((t) => (t.id === existing.id ? refreshed : t)),
          };
    if (activate) next = activateTab(next, existing.id);
    return { state: next, tabId: existing.id };
  }
  const placement = documentPlacement(state, task);
  if (isPreviewTab(tab) && placement.kind === "stack") {
    const target = findCard(task.layout, placement.cardId);
    const slot = target?.tabIds
      .map((id) => tabById(state, id))
      .find((t) => t && t.kind === tab.kind && isPreviewTab(t));
    if (slot) {
      const next = replaceTabId(state, slot.id, tab);
      return {
        state: activate ? activateTab(next, tab.id) : next,
        tabId: tab.id,
      };
    }
  }
  return {
    state: addTab(state, taskId, tab, placement, alloc, { activate }),
    tabId: tab.id,
  };
}

/** Puts `next` in place of tab `oldId`, inheriting its card slot. */
function replaceTabId(
  state: WorkbenchState,
  oldId: number,
  next: Tab,
): WorkbenchState {
  const loc = locateTab(state, oldId);
  if (!loc) return state;
  const layout = updateCard(loc.task.layout, loc.cardId, (c) => ({
    ...c,
    tabIds: c.tabIds.map((id) => (id === oldId ? next.id : id)),
    activeTabId: c.activeTabId === oldId ? next.id : c.activeTabId,
  }));
  return replaceTask(
    {
      ...state,
      tabs: state.tabs.map((t) => (t.id === oldId ? next : t)),
    },
    { ...loc.task, layout },
  );
}

export function updateTab(
  state: WorkbenchState,
  tabId: number,
  update: (tab: Tab) => Tab,
): WorkbenchState {
  let changed = false;
  const tabs = state.tabs.map((t) => {
    if (t.id !== tabId) return t;
    const next = update(t);
    if (next !== t) changed = true;
    return next;
  });
  return changed ? { ...state, tabs } : state;
}

export function applyTabPatch(
  state: WorkbenchState,
  tabId: number,
  patch: TabPatch,
): WorkbenchState {
  return updateTab(state, tabId, (t) => patchTab(t, patch));
}

export type ClosePlan = {
  /** Tabs that will close, in request order. */
  readonly close: readonly Tab[];
  /** Tabs kept because closing them would empty a task's main layout. */
  readonly kept: readonly number[];
};

/**
 * Which of `tabIds` may close. A project's main task always keeps at least one
 * tab, so a request that would empty it keeps that task's last tab.
 */
export function planClose(
  state: WorkbenchState,
  tabIds: readonly number[],
): ClosePlan {
  const requested = new Set(tabIds);
  const kept: number[] = [];
  for (const task of state.tasks) {
    if (task.kind !== "main") continue;
    const own = tabIdsOf(task.layout);
    if (own.length > 0 && own.every((id) => requested.has(id))) {
      const focused = focusedTabId(task);
      requested.delete(focused);
      kept.push(focused);
    }
  }
  const close = tabIds
    .filter((id) => requested.has(id))
    .map((id) => tabById(state, id))
    .filter((t): t is Tab => t !== undefined);
  return { close, kept };
}

function neighborTabInCard(
  tabIds: readonly number[],
  closing: ReadonlySet<number>,
  activeTabId: number,
): number | null {
  const remaining = tabIds.filter((id) => !closing.has(id));
  if (remaining.length === 0) return null;
  if (!closing.has(activeTabId)) return activeTabId;
  const index = tabIds.indexOf(activeTabId);
  for (let i = index - 1; i >= 0; i--)
    if (!closing.has(tabIds[i])) return tabIds[i];
  for (let i = index + 1; i < tabIds.length; i++)
    if (!closing.has(tabIds[i])) return tabIds[i];
  return remaining[0];
}

/**
 * Removes tabs. Emptied cards leave their layout; a non-main task left with no
 * cards closes, handing focus to its neighbour in the project strip. Callers
 * plan with `planClose` first; tabs it would keep are ignored here too.
 */
export function closeTabs(
  state: WorkbenchState,
  tabIds: readonly number[],
): { state: WorkbenchState; closed: Tab[] } {
  const { close } = planClose(state, tabIds);
  if (close.length === 0) return { state, closed: [] };
  const closing = new Set(close.map((t) => t.id));
  let next: WorkbenchState = {
    ...state,
    tabs: state.tabs.filter((t) => !closing.has(t.id)),
  };
  const removedTasks: Task[] = [];
  const tasks: Task[] = [];
  for (const task of state.tasks) {
    if (!tabIdsOf(task.layout).some((id) => closing.has(id))) {
      tasks.push(task);
      continue;
    }
    let layout: LayoutNode | null = task.layout;
    let focusedCardId = task.focusedCardId;
    for (const c of cards(task.layout)) {
      if (!c.tabIds.some((id) => closing.has(id))) continue;
      const nextActive = neighborTabInCard(c.tabIds, closing, c.activeTabId);
      if (nextActive === null) {
        if (layout) {
          const frames = computeFrames(layout).cards;
          if (c.id === focusedCardId) {
            focusedCardId =
              neighborCard(frames, c.id, "left") ??
              neighborCard(frames, c.id, "up") ??
              neighborCard(frames, c.id, "right") ??
              neighborCard(frames, c.id, "down") ??
              focusedCardId;
          }
          layout = removeCard(layout, c.id);
        }
        continue;
      }
      if (layout)
        layout = updateCard(layout, c.id, (old) => ({
          ...old,
          tabIds: old.tabIds.filter((id) => !closing.has(id)),
          activeTabId: nextActive,
        }));
    }
    if (!layout) {
      removedTasks.push(task);
      continue;
    }
    if (!findCard(layout, focusedCardId)) focusedCardId = cardIds(layout)[0];
    const maximizedCardId =
      task.maximizedCardId !== null && findCard(layout, task.maximizedCardId)
        ? task.maximizedCardId
        : null;
    tasks.push({ ...task, layout, focusedCardId, maximizedCardId });
  }
  next = { ...next, tasks };
  for (const removed of removedTasks)
    next = dropTaskFocus(next, state, removed);
  return { state: next, closed: [...close] };
}

/** Repoints a project's active task after `removed` left the strip. */
function dropTaskFocus(
  next: WorkbenchState,
  before: WorkbenchState,
  removed: Task,
): WorkbenchState {
  if (next.activeTaskByProject[removed.projectId] !== removed.id) return next;
  const strip = projectTasks(before, removed.projectId);
  const at = strip.findIndex((t) => t.id === removed.id);
  const remaining = new Set(
    projectTasks(next, removed.projectId).map((t) => t.id),
  );
  const fallback =
    strip
      .slice(0, at)
      .reverse()
      .find((t) => remaining.has(t.id)) ??
    strip.slice(at + 1).find((t) => remaining.has(t.id));
  const activeTaskByProject = { ...next.activeTaskByProject };
  if (fallback) activeTaskByProject[removed.projectId] = fallback.id;
  else delete activeTaskByProject[removed.projectId];
  return { ...next, activeTaskByProject };
}

/** Every tab of a task, for closing it whole (main tasks never close). */
export function taskCloseIds(state: WorkbenchState, taskId: number): number[] {
  const task = taskById(state, taskId);
  if (!task || task.kind === "main") return [];
  return tabIdsOf(task.layout);
}

/** Removes a project's tasks and tabs entirely. */
export function removeProject(
  state: WorkbenchState,
  projectId: string,
): { state: WorkbenchState; closed: Tab[] } {
  const closed = state.tabs.filter((t) => t.spaceId === projectId);
  const activeTaskByProject = { ...state.activeTaskByProject };
  delete activeTaskByProject[projectId];
  return {
    state: {
      ...state,
      tabs: state.tabs.filter((t) => t.spaceId !== projectId),
      tasks: state.tasks.filter((t) => t.projectId !== projectId),
      activeTaskByProject,
    },
    closed,
  };
}

/** Moves a task (and its tabs) to another project; main tasks stay put. */
export function moveTaskToProject(
  state: WorkbenchState,
  taskId: number,
  projectId: string,
): WorkbenchState {
  const task = taskById(state, taskId);
  if (!task || task.kind === "main" || task.projectId === projectId)
    return state;
  const ids = new Set(tabIdsOf(task.layout));
  const moved: Task = { ...task, projectId };
  let next: WorkbenchState = {
    ...state,
    tabs: state.tabs.map((t) =>
      ids.has(t.id) ? ({ ...t, spaceId: projectId } as Tab) : t,
    ),
    tasks: [...state.tasks.filter((t) => t.id !== taskId), moved],
  };
  next = dropTaskFocus(next, state, task);
  if (next.activeTaskByProject[projectId] === undefined)
    next = {
      ...next,
      activeTaskByProject: {
        ...next.activeTaskByProject,
        [projectId]: moved.id,
      },
    };
  return next;
}

function setTaskLayout(
  state: WorkbenchState,
  taskId: number,
  update: (layout: LayoutNode) => LayoutNode,
): WorkbenchState {
  const task = taskById(state, taskId);
  if (!task) return state;
  const layout = update(task.layout);
  return layout === task.layout
    ? state
    : replaceTask(state, { ...task, layout });
}

export function setRatios(
  state: WorkbenchState,
  taskId: number,
  splitId: number,
  ratios: readonly number[],
): WorkbenchState {
  return setTaskLayout(state, taskId, (layout) =>
    setSplitRatios(layout, splitId, ratios),
  );
}

export function toggleMaximize(
  state: WorkbenchState,
  taskId: number,
  cardId?: number,
): WorkbenchState {
  const task = taskById(state, taskId);
  if (!task) return state;
  const target = cardId ?? task.focusedCardId;
  if (cards(task.layout).length < 2 && task.maximizedCardId === null)
    return state;
  const maximizedCardId = task.maximizedCardId === target ? null : target;
  return replaceTask(state, {
    ...task,
    maximizedCardId,
    focusedCardId: target,
  });
}

export function focusDirection(
  state: WorkbenchState,
  taskId: number,
  direction: Direction,
): WorkbenchState {
  const task = taskById(state, taskId);
  if (!task || task.maximizedCardId !== null) return state;
  const frames = computeFrames(task.layout).cards;
  const target = neighborCard(frames, task.focusedCardId, direction);
  return target === null ? state : focusCard(state, taskId, target);
}

export function cycleFocus(
  state: WorkbenchState,
  taskId: number,
  delta: 1 | -1,
): WorkbenchState {
  const task = taskById(state, taskId);
  if (!task) return state;
  return focusCard(
    state,
    taskId,
    cycleCard(task.layout, task.focusedCardId, delta),
  );
}

/** Swaps the focused card's contents with its neighbour; focus follows. */
export function swapDirection(
  state: WorkbenchState,
  taskId: number,
  direction: Direction,
): WorkbenchState {
  const task = taskById(state, taskId);
  if (!task || task.maximizedCardId !== null) return state;
  const frames = computeFrames(task.layout).cards;
  const target = neighborCard(frames, task.focusedCardId, direction);
  if (target === null) return state;
  return replaceTask(state, {
    ...task,
    layout: swapCardContents(task.layout, task.focusedCardId, target),
    focusedCardId: target,
  });
}

/** The layout without `tabId` in its card; an emptied card leaves the layout. */
function detachTab(
  layout: LayoutNode,
  cardId: number,
  tabId: number,
): LayoutNode | null {
  const source = findCard(layout, cardId);
  if (!source) return layout;
  if (source.tabIds.length === 1) return removeCard(layout, cardId);
  const remaining = source.tabIds.filter((id) => id !== tabId);
  const at = source.tabIds.indexOf(tabId);
  return updateCard(layout, cardId, (c) => ({
    ...c,
    tabIds: remaining,
    activeTabId:
      c.activeTabId === tabId
        ? (remaining[Math.max(0, at - 1)] ?? remaining[0])
        : c.activeTabId,
  }));
}

/**
 * Moves a tab into a new card beside `targetCardId` (its own card included,
 * which splits a stacked tab off). A card's only tab cannot split from itself.
 */
export function moveTabToSplit(
  state: WorkbenchState,
  tabId: number,
  targetCardId: number,
  dir: SplitDir,
  side: "before" | "after",
  alloc: Alloc,
): WorkbenchState {
  const loc = locateTab(state, tabId);
  if (!loc) return state;
  const source = findCard(loc.task.layout, loc.cardId);
  if (!source || !findCard(loc.task.layout, targetCardId)) return state;
  if (source.id === targetCardId && source.tabIds.length < 2) return state;
  let layout = detachTab(loc.task.layout, source.id, tabId);
  if (!layout || !findCard(layout, targetCardId)) return state;
  layout = insertCardBeside(
    layout,
    targetCardId,
    card(alloc(), [tabId]),
    dir,
    side,
    alloc,
  );
  return activateTab(
    replaceTask(state, { ...loc.task, layout, maximizedCardId: null }),
    tabId,
  );
}

/** Moves a tab out of a stacked card into a new card after it. */
export function splitOffTab(
  state: WorkbenchState,
  tabId: number,
  dir: SplitDir,
  alloc: Alloc,
): WorkbenchState {
  const loc = locateTab(state, tabId);
  if (!loc) return state;
  return moveTabToSplit(state, tabId, loc.cardId, dir, "after", alloc);
}

/** Moves a tab into another card of the same task at `index`. */
export function moveTabToCard(
  state: WorkbenchState,
  tabId: number,
  targetCardId: number,
  index?: number,
): WorkbenchState {
  const loc = locateTab(state, tabId);
  if (!loc || !findCard(loc.task.layout, targetCardId)) return state;
  if (targetCardId === loc.cardId)
    return index === undefined ? state : reorderInCard(state, tabId, index);
  let layout = detachTab(loc.task.layout, loc.cardId, tabId);
  if (!layout) return state;
  layout = updateCard(layout, targetCardId, (c) => {
    const tabIds = [...c.tabIds];
    const at =
      index === undefined
        ? tabIds.length
        : Math.max(0, Math.min(index, tabIds.length));
    tabIds.splice(at, 0, tabId);
    return { ...c, tabIds, activeTabId: tabId };
  });
  return activateTab(
    replaceTask(state, {
      ...loc.task,
      layout,
      focusedCardId: targetCardId,
      maximizedCardId: null,
    }),
    tabId,
  );
}

/** Reorders a tab within its card to the insertion gap `gap` (0..length). */
export function reorderInCard(
  state: WorkbenchState,
  tabId: number,
  gap: number,
): WorkbenchState {
  const loc = locateTab(state, tabId);
  if (!loc) return state;
  return setTaskLayout(state, loc.task.id, (layout) =>
    updateCard(layout, loc.cardId, (c) => {
      const from = c.tabIds.indexOf(tabId);
      let to = gap > from ? gap - 1 : gap;
      to = Math.max(0, Math.min(to, c.tabIds.length - 1));
      if (to === from) return c;
      const tabIds = c.tabIds.filter((id) => id !== tabId);
      tabIds.splice(to, 0, tabId);
      return { ...c, tabIds };
    }),
  );
}

/** Reorders a task within its project's strip to insertion gap `gap`. */
export function reorderTask(
  state: WorkbenchState,
  taskId: number,
  gap: number,
): WorkbenchState {
  const task = taskById(state, taskId);
  if (!task) return state;
  const strip = projectTasks(state, task.projectId);
  const from = strip.indexOf(task);
  let to = gap > from ? gap - 1 : gap;
  to = Math.max(0, Math.min(to, strip.length - 1));
  if (to === from) return state;
  const reordered = strip.filter((t) => t !== task);
  reordered.splice(to, 0, task);
  let cursor = 0;
  return {
    ...state,
    tasks: state.tasks.map((t) =>
      t.projectId === task.projectId ? reordered[cursor++] : t,
    ),
  };
}

/**
 * Places a task before or after another, adopting that task's project. A
 * main task never leaves its project.
 */
export function placeTask(
  state: WorkbenchState,
  taskId: number,
  targetId: number,
  edge: "top" | "bottom",
): WorkbenchState {
  const task = taskById(state, taskId);
  const target = taskById(state, targetId);
  if (!task || !target || task === target) return state;
  let next = state;
  if (task.projectId !== target.projectId) {
    next = moveTaskToProject(next, taskId, target.projectId);
    if (next === state) return state;
  }
  const strip = projectTasks(next, target.projectId);
  const targetIndex = strip.findIndex((t) => t.id === targetId);
  const gap = edge === "top" ? targetIndex : targetIndex + 1;
  return reorderTask(next, taskId, gap);
}

export function renameTask(
  state: WorkbenchState,
  taskId: number,
  name: string,
): WorkbenchState {
  const task = taskById(state, taskId);
  if (!task) return state;
  const trimmed = name.trim();
  if ((task.name ?? "") === trimmed) return state;
  const next: Task = { ...task, name: trimmed || undefined };
  if (!trimmed) delete (next as { name?: string }).name;
  return replaceTask(state, next);
}

/** Label for a task: its name, else its focused tab's label. */
export function taskLabel(
  task: Task,
  tabs: readonly Tab[],
  labelFor: (tab: Tab) => string,
): string {
  if (task.name) return task.name;
  const tab = tabs.find((t) => t.id === focusedTabId(task));
  if (tab) return labelFor(tab);
  return task.cwd ? basename(task.cwd) : "Task";
}
