import type { WorkflowDocument } from "./schema";

const VERSION_PREFIX = "terax_workflow_version_";
const VERSION_LIST_PREFIX = "terax_workflow_versions_";

export type WorkflowVersionSnapshot = {
  id: string;
  label: string;
  savedAt: string;
  documentId: string;
  documentTitle: string;
  nodeCount: number;
  edgeCount: number;
};

/**
 * Save a version snapshot of a workflow document.
 */
export function saveWorkflowVersion(
  document: WorkflowDocument,
  label: string,
): WorkflowVersionSnapshot {
  if (typeof localStorage === "undefined") {
    throw new Error("localStorage not available");
  }

  const id = `v_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const snapshot: WorkflowVersionSnapshot = {
    id,
    label,
    savedAt: new Date().toISOString(),
    documentId: document.id,
    documentTitle: document.title,
    nodeCount: document.nodes.length,
    edgeCount: document.edges.length,
  };

  // Store the full document
  const versionKey = `${VERSION_PREFIX}${id}`;
  localStorage.setItem(versionKey, JSON.stringify(stripRuntimeState(document)));

  // Update the version list
  const list = loadWorkflowVersionList(document.id);
  list.unshift(snapshot);
  // Cap at 50 versions
  if (list.length > 50) {
    const removed = list.splice(50);
    for (const r of removed) {
      localStorage.removeItem(`${VERSION_PREFIX}${r.id}`);
    }
  }
  localStorage.setItem(
    `${VERSION_LIST_PREFIX}${document.id}`,
    JSON.stringify(list),
  );

  return snapshot;
}

/**
 * Load all version snapshots for a workflow document.
 */
export function loadWorkflowVersionList(
  documentId: string,
): WorkflowVersionSnapshot[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${VERSION_LIST_PREFIX}${documentId}`);
    return raw ? (JSON.parse(raw) as WorkflowVersionSnapshot[]) : [];
  } catch {
    return [];
  }
}

/**
 * Load the full document for a specific version.
 */
export function loadWorkflowVersionDocument(
  versionId: string,
): WorkflowDocument | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${VERSION_PREFIX}${versionId}`);
    return raw ? (JSON.parse(raw) as WorkflowDocument) : null;
  } catch {
    return null;
  }
}

/**
 * Delete a specific version snapshot.
 */
export function deleteWorkflowVersion(
  documentId: string,
  versionId: string,
): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(`${VERSION_PREFIX}${versionId}`);
  const list = loadWorkflowVersionList(documentId);
  const filtered = list.filter((v) => v.id !== versionId);
  localStorage.setItem(
    `${VERSION_LIST_PREFIX}${documentId}`,
    JSON.stringify(filtered),
  );
}

/**
 * Clear all version snapshots for a workflow document.
 */
export function clearWorkflowVersions(documentId: string): void {
  if (typeof localStorage === "undefined") return;
  const list = loadWorkflowVersionList(documentId);
  for (const v of list) {
    localStorage.removeItem(`${VERSION_PREFIX}${v.id}`);
  }
  localStorage.removeItem(`${VERSION_LIST_PREFIX}${documentId}`);
}

/**
 * Strip runtime state from a document for version storage.
 */
function stripRuntimeState(document: WorkflowDocument): WorkflowDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => ({
      ...node,
      runtimeState: {
        status: "idle" as const,
        artifactIds: [],
      },
    })),
    artifacts: [],
    runHistory: [],
  };
}
