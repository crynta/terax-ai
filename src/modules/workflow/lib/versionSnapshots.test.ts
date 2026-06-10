import { describe, expect, it, beforeEach } from "vitest";
import {
  saveWorkflowVersion,
  loadWorkflowVersionList,
  loadWorkflowVersionDocument,
  deleteWorkflowVersion,
  clearWorkflowVersions,
} from "./versionSnapshots";
import { createStarterWorkflowDocument } from "./schema";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

describe("versionSnapshots", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("saves and loads a version snapshot", () => {
    const doc = createStarterWorkflowDocument({ id: "wf1", title: "Test" });
    const snapshot = saveWorkflowVersion(doc, "Initial");

    expect(snapshot.label).toBe("Initial");
    expect(snapshot.documentId).toBe("wf1");
    expect(snapshot.nodeCount).toBe(doc.nodes.length);
    expect(snapshot.edgeCount).toBe(doc.edges.length);

    const list = loadWorkflowVersionList("wf1");
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(snapshot.id);
  });

  it("loads the full document for a version", () => {
    const doc = createStarterWorkflowDocument({ id: "wf1", title: "Test" });
    const snapshot = saveWorkflowVersion(doc, "v1");

    const loaded = loadWorkflowVersionDocument(snapshot.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.title).toBe("Test");
    expect(loaded?.nodes).toHaveLength(doc.nodes.length);
  });

  it("strips runtime state from saved versions", () => {
    let doc = createStarterWorkflowDocument({ id: "wf1", title: "Test" });
    doc = {
      ...doc,
      nodes: doc.nodes.map((n) => ({
        ...n,
        runtimeState: { status: "completed" as const, artifactIds: ["a1"] },
      })),
      artifacts: [{ id: "a1", nodeId: "n1", type: "text", label: "Test", preview: "test" }],
    };
    const snapshot = saveWorkflowVersion(doc, "v1");
    const loaded = loadWorkflowVersionDocument(snapshot.id);

    expect(loaded?.nodes[0]?.runtimeState.status).toBe("idle");
    expect(loaded?.artifacts).toHaveLength(0);
  });

  it("deletes a specific version", () => {
    const doc = createStarterWorkflowDocument({ id: "wf1", title: "Test" });
    const s1 = saveWorkflowVersion(doc, "v1");
    saveWorkflowVersion(doc, "v2");

    deleteWorkflowVersion("wf1", s1.id);

    const list = loadWorkflowVersionList("wf1");
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe("v2");
  });

  it("clears all versions for a document", () => {
    const doc = createStarterWorkflowDocument({ id: "wf1", title: "Test" });
    saveWorkflowVersion(doc, "v1");
    saveWorkflowVersion(doc, "v2");

    clearWorkflowVersions("wf1");

    const list = loadWorkflowVersionList("wf1");
    expect(list).toHaveLength(0);
  });

  it("orders versions newest first", () => {
    const doc = createStarterWorkflowDocument({ id: "wf1", title: "Test" });
    saveWorkflowVersion(doc, "oldest");
    saveWorkflowVersion(doc, "newest");

    const list = loadWorkflowVersionList("wf1");
    expect(list[0].label).toBe("newest");
    expect(list[1].label).toBe("oldest");
  });

  it("isolates versions between documents", () => {
    const doc1 = createStarterWorkflowDocument({ id: "wf1", title: "A" });
    const doc2 = createStarterWorkflowDocument({ id: "wf2", title: "B" });
    saveWorkflowVersion(doc1, "v1-a");
    saveWorkflowVersion(doc2, "v1-b");

    expect(loadWorkflowVersionList("wf1")).toHaveLength(1);
    expect(loadWorkflowVersionList("wf2")).toHaveLength(1);
  });
});
