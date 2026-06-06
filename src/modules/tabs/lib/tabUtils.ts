import { leafIds } from "@/modules/terminal/lib/panes";
import {
  createStarterWorkflowDocument,
  type WorkflowDocument,
} from "@/modules/workflow/lib/schema";
import { workflowTerminalLeafIds } from "@/modules/workflow/lib/terminalNode";
import type { Tab, WorkflowTab } from "./types";

export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

export function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host || url;
  } catch {
    return url || "preview";
  }
}

export function createWorkflowTab(id: number, title = "Workflow"): WorkflowTab {
  return createWorkflowTabFromDocument(
    id,
    createStarterWorkflowDocument({
      id: `workflow-${id}`,
      title,
    }),
  );
}

export function createWorkflowTabFromDocument(
  id: number,
  document: WorkflowDocument,
  path?: string,
): WorkflowTab {
  return {
    id,
    kind: "workflow",
    title: document.title,
    document,
    dirty: false,
    ...(path !== undefined && { path }),
  };
}

export function terminalLeafIdsForTab(tab: Tab): number[] {
  if (tab.kind === "terminal") return leafIds(tab.paneTree);
  if (tab.kind === "workflow") return workflowTerminalLeafIds(tab.document);
  return [];
}

export function replaceWorkflowTabDocument(
  tabs: Tab[],
  id: number,
  document: WorkflowDocument,
  options: { dirty?: boolean; path?: string } = {},
): Tab[] {
  return tabs.map((tab) =>
    tab.id === id && tab.kind === "workflow"
      ? {
          ...tab,
          title: document.title,
          document,
          dirty: options.dirty ?? true,
          ...(options.path !== undefined && { path: options.path }),
        }
      : tab,
  );
}

export function upsertPiWorkspaceTab(
  tabs: Tab[],
  nextId: number,
): { activeId: number; tabs: Tab[] } {
  const existing = tabs.find((tab) => tab.kind === "pi-workspace");
  if (existing) return { activeId: existing.id, tabs };
  return {
    activeId: nextId,
    tabs: [...tabs, { id: nextId, kind: "pi-workspace", title: "Code" }],
  };
}

export type ArtifactWorkspaceTabInput = {
  conversationId: string;
  selectedSlug?: string | null;
  title?: string;
};

export function upsertArtifactWorkspaceTab(
  tabs: Tab[],
  nextId: number,
  input: ArtifactWorkspaceTabInput,
): { activeId: number; tabs: Tab[] } {
  const existing = tabs.find(
    (tab) =>
      tab.kind === "artifact" && tab.conversationId === input.conversationId,
  );
  if (existing) {
    return {
      activeId: existing.id,
      tabs: tabs.map((tab) =>
        tab.id === existing.id && tab.kind === "artifact"
          ? {
              ...tab,
              ...(input.selectedSlug !== undefined && {
                selectedSlug: input.selectedSlug,
              }),
              ...(input.title !== undefined && { title: input.title }),
            }
          : tab,
      ),
    };
  }
  return {
    activeId: nextId,
    tabs: [
      ...tabs,
      {
        conversationId: input.conversationId,
        id: nextId,
        kind: "artifact",
        selectedSlug: input.selectedSlug ?? null,
        title: input.title ?? "Artifacts",
      },
    ],
  };
}

export function upsertWorkflowDocumentTab(
  tabs: Tab[],
  nextId: number,
  document: WorkflowDocument,
  path?: string,
): { activeId: number; tabs: Tab[] } {
  const existing = path
    ? tabs.find((tab) => tab.kind === "workflow" && tab.path === path)
    : undefined;
  if (existing) {
    return {
      activeId: existing.id,
      tabs: replaceWorkflowTabDocument(tabs, existing.id, document, {
        dirty: false,
      }),
    };
  }

  return {
    activeId: nextId,
    tabs: [...tabs, createWorkflowTabFromDocument(nextId, document, path)],
  };
}
