import type { WorkflowDocument } from "./schema";

export type WorkflowUserTemplate = {
  id: string;
  title: string;
  description: string;
  document: Omit<WorkflowDocument, "id" | "runHistory" | "artifacts">;
};

const TEMPLATE_STORAGE_KEY = "terax-workflow-templates";

/**
 * Load user templates from localStorage.
 */
export function loadUserTemplates(): WorkflowUserTemplate[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Save a workflow document as a user template.
 */
export function saveUserTemplate(
  title: string,
  description: string,
  document: WorkflowDocument,
): WorkflowUserTemplate {
  const templates = loadUserTemplates();
  const { id: _id, runHistory: _rh, artifacts: _art, ...doc } = document;
  const template: WorkflowUserTemplate = {
    id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    description,
    document: doc,
  };
  templates.push(template);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
  }
  return template;
}

/**
 * Delete a user template by ID.
 */
export function deleteUserTemplate(templateId: string): void {
  const templates = loadUserTemplates().filter((t) => t.id !== templateId);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
  }
}

/**
 * Load a user template into a new document by merging with a starter.
 */
export function documentFromTemplate(
  template: WorkflowUserTemplate,
  newId: string,
): WorkflowDocument {
  return {
    id: newId,
    title: template.title,
    version: template.document.version,
    nodes: template.document.nodes.map((n) => ({
      ...n,
      runtimeState: { status: "idle" },
    })),
    edges: template.document.edges,
    variables: template.document.variables ?? [],
    artifacts: [],
    viewport: template.document.viewport,
  };
}
