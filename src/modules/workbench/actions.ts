import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { workspaceScopeKey } from "@/modules/workspace";
import { toast } from "sonner";
import { isMarkdownPath } from "@/lib/utils";
import {
  type AgentInstanceCount,
  createAgentPanePlan,
} from "@/modules/agents/lib/launcher";
import {
  type AiDiffInput,
  type AiDiffStatus,
  basename,
  type CommitFileDiffInput,
  type EditorTab,
  type GitDiffOpenInput,
  type GitDiffTab,
  type MarkdownTab,
  type Tab,
  type TabPatch,
  type TerminalTab,
  titleFromUrl,
} from "@/modules/tabs/lib/tabs";
import { type DropZone, zoneSplit } from "./model/dropZone";
import { type Direction, findCard, type SplitDir } from "./model/layout";
import * as wb from "./model/workbench";
import { allocId, commit, snapshot } from "./store";
import { canFocusTab } from "./viewFocus";
import { whenViewHandle } from "./viewHandles";

export type TerminalOptions = {
  cwd?: string;
  blocks?: boolean;
  private?: boolean;
  title?: string;
};

function terminalTab(projectId: string, options: TerminalOptions): TerminalTab {
  const tab: TerminalTab = {
    id: allocId(),
    kind: "terminal",
    spaceId: projectId,
    title:
      options.title ??
      (options.private ? "private" : options.blocks ? "blocks" : "shell"),
  };
  if (options.cwd) tab.cwd = options.cwd;
  if (options.blocks) tab.blocks = true;
  if (options.private) tab.private = true;
  return tab;
}

function currentTask(): wb.Task | undefined {
  return wb.activeTask(snapshot());
}

export function activateTab(tabId: number) {
  commit((s) => wb.activateTab(s, tabId));
}

export function activateTask(taskId: number) {
  commit((s) => wb.activateTask(s, taskId));
}

export function selectProject(projectId: string) {
  commit((s) => wb.selectProject(s, projectId));
}

export function focusCard(taskId: number, cardId: number) {
  commit((s) => wb.focusCard(s, taskId, cardId));
}

/** A new terminal tab stacked in the focused card. */
export function newTerminal(options: TerminalOptions = {}): number | null {
  const task = currentTask();
  if (!task) return null;
  const tab = terminalTab(task.projectId, {
    ...options,
    cwd: options.cwd ?? task.cwd,
  });
  commit((s) =>
    wb.addTab(
      s,
      task.id,
      tab,
      { kind: "stack", cardId: task.focusedCardId },
      allocId,
    ),
  );
  return tab.id;
}

/** A new terminal in a new card beside `cardId` (default: the focused card). */
export function splitTerminal(
  dir: SplitDir,
  cwd?: string,
  target?: { taskId: number; cardId: number },
): number | null {
  const task = target ? wb.taskById(snapshot(), target.taskId) : currentTask();
  if (!task) return null;
  const tab = terminalTab(task.projectId, { cwd: cwd ?? task.cwd });
  commit((s) =>
    wb.addTab(
      s,
      task.id,
      tab,
      { kind: "split", cardId: target?.cardId ?? task.focusedCardId, dir },
      allocId,
    ),
  );
  return tab.id;
}

/** A new terminal stacked in a given card. */
export function newTerminalInCard(
  taskId: number,
  cardId: number,
  options: TerminalOptions = {},
): number | null {
  const task = wb.taskById(snapshot(), taskId);
  if (!task) return null;
  const tab = terminalTab(task.projectId, {
    ...options,
    cwd: options.cwd ?? task.cwd,
  });
  commit((s) => wb.addTab(s, taskId, tab, { kind: "stack", cardId }, allocId));
  return tab.id;
}

/** A blank preview stacked in a given card. */
export function newPreviewInCard(
  taskId: number,
  cardId: number,
): number | null {
  const task = wb.taskById(snapshot(), taskId);
  if (!task) return null;
  const tab: Tab = {
    id: allocId(),
    kind: "preview",
    spaceId: task.projectId,
    title: titleFromUrl(""),
    url: "",
  };
  commit((s) => wb.addTab(s, taskId, tab, { kind: "stack", cardId }, allocId));
  focusAddressBarWhenReady(tab.id);
  return tab.id;
}

/** Every tab of a card, in strip order. */
export function cardTabIds(taskId: number, cardId: number): number[] {
  const task = wb.taskById(snapshot(), taskId);
  const c = task && findCard(task.layout, cardId);
  return c ? [...c.tabIds] : [];
}

/** A new local task in the active project, holding one terminal card. */
export function newTask(
  options: TerminalOptions & { projectId?: string; activate?: boolean } = {},
): { taskId: number; tabId: number } {
  const s = snapshot();
  const projectId = options.projectId ?? s.activeProjectId;
  const tab = terminalTab(projectId, options);
  let taskId = -1;
  commit((state) => {
    const result = wb.addSingleTabTask(
      state,
      { projectId, kind: "local", cwd: options.cwd },
      tab,
      allocId,
      { activate: options.activate },
    );
    taskId = result.task.id;
    return result.state;
  });
  return { taskId, tabId: tab.id };
}

/** A task holding `instances` agent terminals laid out side by side. */
export function newAgentTask(
  cwd: string | undefined,
  title: string,
  instances: AgentInstanceCount,
): { taskId: number; leafIds: number[] } {
  const projectId = snapshot().activeProjectId;
  const plan = createAgentPanePlan(instances, allocId);
  const tabs = plan.leafIds.map(
    (id): TerminalTab => ({
      id,
      kind: "terminal",
      spaceId: projectId,
      title,
      ...(cwd && { cwd }),
    }),
  );
  let taskId = -1;
  commit((state) => {
    const result = wb.addTask(
      state,
      { projectId, kind: "local", name: title, cwd },
      tabs,
      plan.layout,
      plan.focusedCardId,
      allocId,
    );
    taskId = result.task.id;
    return result.state;
  });
  return { taskId, leafIds: plan.leafIds };
}

export type OpenOptions = { projectId?: string; activate?: boolean };

function taskForOpen(projectId?: string): wb.Task | undefined {
  const s = snapshot();
  return wb.activeTask(s, projectId ?? s.activeProjectId);
}

function samePath(a: string, b: string) {
  return a.replace(/\\/g, "/") === b.replace(/\\/g, "/");
}

/**
 * Opens a file in the active task's document card. `pin = false` uses the
 * card's single preview slot (replaced by the next preview open).
 */
export function openFile(
  path: string,
  pin = true,
  options: OpenOptions = {},
): number | null {
  const task = taskForOpen(options.projectId);
  if (!task) return null;
  const tab: EditorTab = {
    id: allocId(),
    kind: "editor",
    spaceId: task.projectId,
    title: basename(path),
    path,
    dirty: false,
    preview: !pin,
  };
  let tabId = tab.id;
  commit((s) => {
    const result = wb.openDocument(
      s,
      task.id,
      tab,
      (t) => t.kind === "editor" && samePath(t.path, path),
      allocId,
      {
        activate: options.activate,
        refresh: (existing) =>
          pin && existing.kind === "editor" && existing.preview
            ? { ...existing, preview: false }
            : existing,
      },
    );
    tabId = result.tabId;
    return result.state;
  });
  return tabId;
}

function openMarkdown(path: string): number | null {
  const task = currentTask();
  if (!task) return null;
  const tab: MarkdownTab = {
    id: allocId(),
    kind: "markdown",
    spaceId: task.projectId,
    title: basename(path),
    path,
  };
  let tabId = tab.id;
  commit((s) => {
    const result = wb.openDocument(
      s,
      task.id,
      tab,
      (t) => t.kind === "markdown" && samePath(t.path, path),
      allocId,
    );
    tabId = result.tabId;
    return result.state;
  });
  return tabId;
}

/** Markdown opens rendered; other files open in the editor. */
export function openPath(path: string, pin?: boolean): number | null {
  return isMarkdownPath(path)
    ? openMarkdown(path)
    : openFile(path, pin ?? false);
}

export function openPreview(url: string): number | null {
  const task = currentTask();
  if (!task) return null;
  const tab: Tab = {
    id: allocId(),
    kind: "preview",
    spaceId: task.projectId,
    title: titleFromUrl(url),
    url,
  };
  commit((s) =>
    wb.addTab(s, task.id, tab, wb.documentPlacement(s, task), allocId),
  );
  if (!url) focusAddressBarWhenReady(tab.id);
  return tab.id;
}

/** A blank preview asks for a URL: its address bar takes focus once mounted. */
function focusAddressBarWhenReady(tabId: number) {
  whenViewHandle(tabId, "preview", (preview) => {
    if (canFocusTab(tabId)) preview.focusAddressBar();
  });
}

export function openGitDiff(
  input: GitDiffOpenInput,
  pin = false,
): number | null {
  const task = currentTask();
  if (!task) return null;
  const title = input.title ?? `${basename(input.path)} (${input.mode})`;
  const originalPath = input.originalPath ?? null;
  const tab: GitDiffTab = {
    id: allocId(),
    kind: "git-diff",
    spaceId: task.projectId,
    title,
    path: input.path,
    repoRoot: input.repoRoot,
    mode: input.mode,
    originalPath,
    preview: !pin,
  };
  let tabId = tab.id;
  commit((s) => {
    const result = wb.openDocument(
      s,
      task.id,
      tab,
      (t) =>
        t.kind === "git-diff" &&
        t.repoRoot === input.repoRoot &&
        t.path === input.path &&
        t.mode === input.mode,
      allocId,
      {
        refresh: (existing) => {
          if (existing.kind !== "git-diff") return existing;
          const preview = pin ? false : existing.preview;
          return existing.title === title &&
            existing.originalPath === originalPath &&
            existing.preview === preview
            ? existing
            : { ...existing, title, originalPath, preview };
        },
      },
    );
    tabId = result.tabId;
    return result.state;
  });
  return tabId;
}

export function openCommitHistory(input: {
  repoRoot: string;
  branch?: string | null;
}): number | null {
  const task = currentTask();
  if (!task) return null;
  const title = input.branch ? `History · ${input.branch}` : "Git History";
  const tab: Tab = {
    id: allocId(),
    kind: "git-history",
    spaceId: task.projectId,
    title,
    repoRoot: input.repoRoot,
  };
  let tabId = tab.id;
  commit((s) => {
    const result = wb.openDocument(
      s,
      task.id,
      tab,
      (t) => t.kind === "git-history" && t.repoRoot === input.repoRoot,
      allocId,
      {
        refresh: (existing) =>
          existing.title === title ? existing : { ...existing, title },
      },
    );
    tabId = result.tabId;
    return result.state;
  });
  return tabId;
}

export function openCommitFileDiff(input: CommitFileDiffInput): number | null {
  const task = currentTask();
  if (!task) return null;
  const title = `${basename(input.path)} @ ${input.shortSha}`;
  const tab: Tab = {
    id: allocId(),
    kind: "git-commit-file",
    spaceId: task.projectId,
    title,
    ...input,
  };
  let tabId = tab.id;
  commit((s) => {
    const result = wb.openDocument(
      s,
      task.id,
      tab,
      (t) =>
        t.kind === "git-commit-file" &&
        t.repoRoot === input.repoRoot &&
        t.sha === input.sha &&
        t.path === input.path,
      allocId,
      {
        refresh: (existing) =>
          existing.kind === "git-commit-file"
            ? {
                ...existing,
                title,
                subject: input.subject,
                originalPath: input.originalPath,
              }
            : existing,
      },
    );
    tabId = result.tabId;
    return result.state;
  });
  return tabId;
}

export function openAiDiff(input: AiDiffInput): number | null {
  const s = snapshot();
  const existing = s.tabs.find(
    (t) => t.kind === "ai-diff" && t.approvalId === input.approvalId,
  );
  if (existing) {
    activateTab(existing.id);
    return existing.id;
  }
  const task = wb.activeTask(s);
  if (!task) return null;
  const tab: Tab = {
    id: allocId(),
    kind: "ai-diff",
    spaceId: task.projectId,
    title: `${basename(input.path)} (AI diff)`,
    status: "pending",
    ...input,
  };
  commit((state) =>
    wb.addTab(state, task.id, tab, wb.documentPlacement(state, task), allocId),
  );
  return tab.id;
}

function setAiDiffStatus(approvalId: string, status: AiDiffStatus) {
  commit((s) => {
    const tab = s.tabs.find(
      (t) => t.kind === "ai-diff" && t.approvalId === approvalId,
    );
    return tab
      ? wb.updateTab(s, tab.id, (t) =>
          t.kind === "ai-diff" && t.status !== status ? { ...t, status } : t,
        )
      : s;
  });
}

/** Closes a resolved AI diff; marks it approved when it cannot close. */
export function closeAiDiff(approvalId: string) {
  const tab = snapshot().tabs.find(
    (t) => t.kind === "ai-diff" && t.approvalId === approvalId,
  );
  if (!tab) return;
  if (wb.planClose(snapshot(), [tab.id]).close.length === 0) {
    setAiDiffStatus(approvalId, "approved");
    return;
  }
  closeTabsNow([tab.id]);
}

export function updateTab(tabId: number, patch: TabPatch) {
  commit((s) => wb.applyTabPatch(s, tabId, patch));
}

export function pinTab(tabId: number) {
  commit((s) =>
    wb.updateTab(s, tabId, (t) =>
      (t.kind === "editor" || t.kind === "git-diff") && t.preview
        ? { ...t, preview: false }
        : t,
    ),
  );
}

export function setOverrideLanguage(tabId: number, lang: string | null) {
  commit((s) =>
    wb.updateTab(s, tabId, (t) =>
      t.kind === "editor" && t.overrideLanguage !== lang
        ? { ...t, overrideLanguage: lang }
        : t,
    ),
  );
}

/** Flips a markdown file between its rendered view and the raw editor. */
export function setMarkdownView(tabId: number, mode: "rendered" | "raw") {
  commit((s) =>
    wb.updateTab(s, tabId, (t) => {
      if (!("path" in t) || !isMarkdownPath(t.path)) return t;
      if (mode === "raw" && t.kind === "markdown") {
        return {
          id: t.id,
          kind: "editor",
          spaceId: t.spaceId,
          title: t.title,
          path: t.path,
          dirty: false,
          preview: false,
          overrideLanguage: t.overrideLanguage ?? null,
        };
      }
      if (mode === "rendered" && t.kind === "editor" && !t.dirty) {
        return {
          id: t.id,
          kind: "markdown",
          spaceId: t.spaceId,
          title: t.title,
          path: t.path,
          overrideLanguage: t.overrideLanguage ?? null,
        };
      }
      return t;
    }),
  );
}

/** Closes tabs without confirmation. Returns the ids that closed. */
export function closeTabsNow(tabIds: readonly number[]): number[] {
  let closed: Tab[] = [];
  commit((s) => {
    const result = wb.closeTabs(s, tabIds);
    closed = result.closed;
    return result.state;
  });
  return closed.map((t) => t.id);
}

/**
 * Closes tabs whose content is gone (deleted files). A project's main task
 * cannot be emptied, so it first gets a fresh terminal where needed.
 */
export function closeTabsReplacingLast(tabIds: readonly number[]): number[] {
  const s = snapshot();
  const { kept } = wb.planClose(s, tabIds);
  for (const id of kept) {
    const loc = wb.locateTab(s, id);
    if (!loc) continue;
    const tab = terminalTab(loc.task.projectId, { cwd: loc.task.cwd });
    commit((state) =>
      wb.addTab(
        state,
        loc.task.id,
        tab,
        { kind: "stack", cardId: loc.cardId },
        allocId,
        { activate: false },
      ),
    );
  }
  return closeTabsNow(tabIds);
}

/** Restarts a shell in its existing card slot, preserving its options. */
export function restartTerminal(tabId: number) {
  const tab = wb.tabById(snapshot(), tabId);
  if (tab?.kind !== "terminal") return;
  const next = { ...tab, id: allocId(), cold: false };
  commit((s) => wb.replaceTabId(s, tabId, next));
}

export function reportTerminalCwd(tabId: number, cwd: string) {
  commit((s) =>
    wb.updateTab(s, tabId, (t) =>
      t.kind === "terminal" && t.cwd !== cwd ? { ...t, cwd } : t,
    ),
  );
}

export function renameTask(taskId: number, name: string) {
  commit((s) => wb.renameTask(s, taskId, name));
}

export function reorderTask(taskId: number, gap: number) {
  commit((s) => wb.reorderTask(s, taskId, gap));
}

export function reorderTabInCard(tabId: number, gap: number) {
  commit((s) => wb.reorderInCard(s, tabId, gap));
}

export function placeTask(
  taskId: number,
  targetId: number,
  edge: "top" | "bottom",
) {
  const target = wb.taskById(snapshot(), targetId);
  if (!target || !canTransferTask(taskId, target.projectId)) return;
  commit((s) => wb.placeTask(s, taskId, targetId, edge));
}

function canTransferTask(taskId: number, projectId: string): boolean {
  const task = wb.taskById(snapshot(), taskId);
  if (!task) return false;
  if (task.projectId === projectId) return true;
  const spaces = useSpaces.getState().spaces;
  const from = spaces.find((p) => p.id === task.projectId)?.env;
  const to = spaces.find((p) => p.id === projectId)?.env;
  if (from && to && workspaceScopeKey(from) === workspaceScopeKey(to))
    return true;
  toast.error(
    "Tasks can only move between projects using the same environment.",
  );
  return false;
}

export function moveTaskToProject(taskId: number, projectId: string) {
  if (!canTransferTask(taskId, projectId)) return;
  commit((s) => wb.moveTaskToProject(s, taskId, projectId));
}

export function splitOffTab(tabId: number, dir: SplitDir) {
  commit((s) => wb.splitOffTab(s, tabId, dir, allocId));
}

export function moveTabToCard(tabId: number, cardId: number, index?: number) {
  commit((s) => wb.moveTabToCard(s, tabId, cardId, index));
}

/** Drops a tab on a card's edge: it gets its own card on that side. */
export function moveTabToSplit(
  tabId: number,
  cardId: number,
  zone: Exclude<DropZone, "stack">,
) {
  const { dir, side } = zoneSplit(zone);
  commit((s) => wb.moveTabToSplit(s, tabId, cardId, dir, side, allocId));
}

export function focusDirection(direction: Direction) {
  const task = currentTask();
  if (task) commit((s) => wb.focusDirection(s, task.id, direction));
}

export function cycleFocus(delta: 1 | -1) {
  const task = currentTask();
  if (task) commit((s) => wb.cycleFocus(s, task.id, delta));
}

export function swapDirection(direction: Direction) {
  const task = currentTask();
  if (task) commit((s) => wb.swapDirection(s, task.id, direction));
}

export function toggleMaximize(taskId?: number, cardId?: number) {
  const id = taskId ?? currentTask()?.id;
  if (id !== undefined) commit((s) => wb.toggleMaximize(s, id, cardId));
}

export function setRatios(
  taskId: number,
  splitId: number,
  ratios: readonly number[],
) {
  commit((s) => wb.setRatios(s, taskId, splitId, ratios));
}

/** Removes a project's tasks; the fallback project gets a task if empty. */
export function removeProject(
  projectId: string,
  fallbackProjectId: string,
  fallbackCwd?: string,
) {
  commit((s) => wb.removeProject(s, projectId).state);
  ensureProjectHasMain(fallbackProjectId, fallbackCwd);
  selectProject(fallbackProjectId);
}

/** Replaces a project's tasks with a fresh main task (workspace env switch). */
export function resetProject(projectId: string, cwd?: string) {
  commit((s) => wb.removeProject(s, projectId).state);
  ensureProjectHasMain(projectId, cwd);
  const main = snapshot().tasks.find(
    (t) => t.projectId === projectId && t.kind === "main",
  );
  if (main) commit((s) => wb.activateTask(s, main.id));
}

/** Gives a project its permanent main task when it has none. */
export function ensureProjectHasMain(projectId: string, cwd?: string) {
  const s = snapshot();
  if (s.tasks.some((t) => t.projectId === projectId && t.kind === "main"))
    return;
  const tab = terminalTab(projectId, { cwd });
  tab.cold = true;
  commit((state) => {
    const result = wb.addSingleTabTask(
      state,
      { projectId, kind: "main", cwd },
      tab,
      allocId,
      { activate: false },
    );
    return result.state;
  });
}
