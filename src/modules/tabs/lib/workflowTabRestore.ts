import {
  parseWorkflowDocumentJson,
  serializeWorkflowDocumentForPersistence,
  type WorkflowDocument,
} from "@/modules/workflow/lib/schema";
import type { Tab } from "./useTabs";

export const WORKFLOW_TAB_RESTORE_STORAGE_KEY = "terax.workflow.openTabs";
export const WORKFLOW_TAB_RESTORE_VERSION = 1;

export type WorkflowTabRestoreEntry = {
  document: WorkflowDocument;
  dirty: boolean;
  path?: string;
};

export type WorkflowTabRestoreState = {
  activeIndex: number | null;
  tabs: WorkflowTabRestoreEntry[];
};

export type WorkflowTabRestoreSnapshot = {
  version: typeof WORKFLOW_TAB_RESTORE_VERSION;
  activeIndex: number | null;
  tabs: Array<{
    documentJson: string;
    dirty: boolean;
    path?: string;
  }>;
};

type WorkflowTabRestoreStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export function workflowTabsRestoreSnapshot(
  tabs: Tab[],
  activeId: number,
): WorkflowTabRestoreSnapshot {
  const workflowTabs = tabs.filter((tab) => tab.kind === "workflow");
  const activeIndex = workflowTabs.findIndex((tab) => tab.id === activeId);
  return {
    activeIndex: activeIndex >= 0 ? activeIndex : null,
    tabs: workflowTabs.map((tab) => ({
      dirty: tab.dirty,
      documentJson: serializeWorkflowDocumentForPersistence(tab.document),
      ...(tab.path !== undefined && { path: tab.path }),
    })),
    version: WORKFLOW_TAB_RESTORE_VERSION,
  };
}

export function parseWorkflowTabsRestoreSnapshot(
  raw: string | null | undefined,
): WorkflowTabRestoreState {
  if (!raw) return { activeIndex: null, tabs: [] };

  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value) || value.version !== WORKFLOW_TAB_RESTORE_VERSION) {
      return { activeIndex: null, tabs: [] };
    }
    if (!Array.isArray(value.tabs)) return { activeIndex: null, tabs: [] };

    const requestedActiveIndex =
      typeof value.activeIndex === "number" &&
      Number.isInteger(value.activeIndex) &&
      value.activeIndex >= 0
        ? value.activeIndex
        : null;
    const tabs: WorkflowTabRestoreEntry[] = [];
    let activeIndex: number | null = null;

    value.tabs.forEach((entry, rawIndex) => {
      if (!isRecord(entry) || typeof entry.documentJson !== "string") return;
      const parsed = parseWorkflowDocumentJson(entry.documentJson);
      if (!parsed.ok) return;
      if (requestedActiveIndex === rawIndex) activeIndex = tabs.length;
      tabs.push({
        dirty: entry.dirty === true,
        document: parsed.document,
        ...(typeof entry.path === "string" && entry.path.length > 0
          ? { path: entry.path }
          : {}),
      });
    });

    return {
      activeIndex:
        activeIndex !== null && activeIndex >= 0 && activeIndex < tabs.length
          ? activeIndex
          : null,
      tabs,
    };
  } catch {
    return { activeIndex: null, tabs: [] };
  }
}

export function readWorkflowTabsRestoreState(
  storage: WorkflowTabRestoreStorage | null = defaultWorkflowTabRestoreStorage(),
): WorkflowTabRestoreState {
  if (!storage) return { activeIndex: null, tabs: [] };
  return parseWorkflowTabsRestoreSnapshot(
    storage.getItem(WORKFLOW_TAB_RESTORE_STORAGE_KEY),
  );
}

export function writeWorkflowTabsRestoreState(
  tabs: Tab[],
  activeId: number,
  storage: WorkflowTabRestoreStorage | null = defaultWorkflowTabRestoreStorage(),
): void {
  if (!storage) return;
  storage.setItem(
    WORKFLOW_TAB_RESTORE_STORAGE_KEY,
    JSON.stringify(workflowTabsRestoreSnapshot(tabs, activeId)),
  );
}

function defaultWorkflowTabRestoreStorage(): WorkflowTabRestoreStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
