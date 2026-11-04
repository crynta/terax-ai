import type { Tab } from "@/modules/tabs/lib/tabs";
import { card, cards, type LayoutNode, type SplitDir, split } from "./layout";
import { type HydratedProject, hydrateTab, isRecord, str } from "./persistence";
import type { Alloc, Task } from "./workbench";

/** The pre-workbench per-space format (`state:<id>` in terax-spaces.json). */
export type LegacyNode =
  | { kind: "leaf"; cwd?: string; active?: boolean }
  | { kind: "split"; dir: SplitDir; children: LegacyNode[] };
export type LegacyTab =
  | {
      kind: "terminal";
      tree: LegacyNode;
      blocks?: boolean;
      customTitle?: string;
    }
  | { kind: "editor"; path: string }
  | { kind: "preview"; url: string }
  | { kind: "markdown"; path: string };
export type LegacySpaceState = { tabs: LegacyTab[]; activeTabIndex: number };

function legacyLayout(
  node: unknown,
  projectId: string,
  alloc: Alloc,
  out: { tabs: Tab[]; focused: number | null },
  depth = 0,
): LayoutNode | null {
  if (!isRecord(node) || depth > 32) return null;
  if (node.kind === "leaf") {
    const tab = hydrateTab(
      { kind: "terminal", cwd: node.cwd },
      projectId,
      alloc,
    );
    if (!tab) return null;
    out.tabs.push(tab);
    const c = card(alloc(), [tab.id]);
    if (node.active === true && out.focused === null) out.focused = c.id;
    return c;
  }
  if (node.kind === "split" && (node.dir === "row" || node.dir === "col")) {
    const children = (Array.isArray(node.children) ? node.children : [])
      .map((child) => legacyLayout(child, projectId, alloc, out, depth + 1))
      .filter((child): child is LayoutNode => child !== null);
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    return split(alloc(), node.dir, children);
  }
  return null;
}

/**
 * Converts a pre-workbench space: each terminal tab becomes a task (its split
 * panes become cards, the first one is the project's main task), and every
 * document tab stacks into one card beside the main task's terminals.
 */
export function migrateLegacySpace(
  raw: unknown,
  projectId: string,
  alloc: Alloc,
): HydratedProject {
  const empty: HydratedProject = {
    tabs: [],
    tasks: [],
    activeTaskId: null,
    dropped: 0,
  };
  if (!isRecord(raw) || !Array.isArray(raw.tabs)) return empty;
  const activeIndex =
    typeof raw.activeTabIndex === "number" ? raw.activeTabIndex : 0;
  const tabs: Tab[] = [];
  const tasks: Task[] = [];
  const documents: Tab[] = [];
  let activeTaskId: number | null = null;
  let activeDocumentId: number | null = null;
  const now = Date.now();

  raw.tabs.forEach((entry: unknown, index: number) => {
    if (!isRecord(entry)) return;
    if (entry.kind === "terminal") {
      const out = { tabs: [] as Tab[], focused: null as number | null };
      const layout = legacyLayout(entry.tree, projectId, alloc, out);
      if (!layout) return;
      const customTitle = str(entry.customTitle);
      for (const tab of out.tabs) {
        if (tab.kind !== "terminal") continue;
        if (entry.blocks === true) tab.blocks = true;
        if (customTitle) {
          tab.customTitle = customTitle;
          tab.title = customTitle;
        }
      }
      tabs.push(...out.tabs);
      const first = cards(layout)[0];
      const task: Task = {
        id: alloc(),
        projectId,
        kind: tasks.length === 0 ? "main" : "local",
        ...(first && tabCwd(out.tabs, first.activeTabId)),
        createdAt: now,
        layout,
        focusedCardId: out.focused ?? first.id,
        maximizedCardId: null,
      };
      tasks.push(task);
      if (index === activeIndex) activeTaskId = task.id;
      return;
    }
    const tab = hydrateTab(entry, projectId, alloc);
    if (!tab) return;
    documents.push(tab);
    if (index === activeIndex) activeDocumentId = tab.id;
  });

  if (documents.length > 0) {
    tabs.push(...documents);
    const docCard = card(
      alloc(),
      documents.map((t) => t.id),
      activeDocumentId ?? documents[0].id,
    );
    if (tasks.length === 0) {
      tasks.push({
        id: alloc(),
        projectId,
        kind: "main",
        createdAt: now,
        layout: docCard,
        focusedCardId: docCard.id,
        maximizedCardId: null,
      });
    } else {
      const main = tasks[0];
      tasks[0] = {
        ...main,
        layout: split(alloc(), "row", [main.layout, docCard]),
        ...(activeDocumentId !== null && { focusedCardId: docCard.id }),
      };
    }
    if (activeDocumentId !== null) activeTaskId = tasks[0].id;
  }

  return {
    tabs,
    tasks,
    activeTaskId: activeTaskId ?? tasks[0]?.id ?? null,
    dropped: 0,
  };
}

function tabCwd(tabs: readonly Tab[], id: number): { cwd?: string } {
  const tab = tabs.find((t) => t.id === id);
  return tab?.kind === "terminal" && tab.cwd ? { cwd: tab.cwd } : {};
}
