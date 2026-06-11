import { describe, expect, it } from "vitest";
import { diffWorkflowDocuments, summarizeStructureDiff } from "./structureDiff";
import {
  createStarterWorkflowDocument,
  addWorkflowNode,
  updateWorkflowNodeConfig,
} from "./schema";

describe("diffWorkflowDocuments", () => {
  it("detects no changes for identical documents", () => {
    const doc = createStarterWorkflowDocument({ id: "wf1", title: "Test" });
    const diff = diffWorkflowDocuments(doc, doc);
    expect(diff.addedNodes).toHaveLength(0);
    expect(diff.removedNodes).toHaveLength(0);
    expect(diff.modifiedNodes).toHaveLength(0);
    expect(summarizeStructureDiff(diff)).toBe("No changes");
  });

  it("detects added nodes", () => {
    const left = createStarterWorkflowDocument({ id: "wf1", title: "Test" });
    const right = addWorkflowNode(left, {
      id: "n1",
      type: "textPrompt",
      position: { x: 100, y: 100 },
    });
    const diff = diffWorkflowDocuments(left, right);
    expect(diff.addedNodes).toHaveLength(1);
    expect(diff.addedNodes[0].id).toBe("n1");
    expect(summarizeStructureDiff(diff)).toContain("+1 nodes");
  });

  it("detects removed nodes", () => {
    let left = createStarterWorkflowDocument({ id: "wf1", title: "Test" });
    left = addWorkflowNode(left, {
      id: "n1",
      type: "textPrompt",
      position: { x: 100, y: 100 },
    });
    const right = createStarterWorkflowDocument({ id: "wf1", title: "Test" });
    const diff = diffWorkflowDocuments(left, right);
    expect(diff.removedNodes).toHaveLength(1);
    expect(diff.removedNodes[0].id).toBe("n1");
  });

  it("detects config changes", () => {
    let left = createStarterWorkflowDocument({ id: "wf1", title: "Test" });
    left = addWorkflowNode(left, {
      id: "n1",
      type: "textPrompt",
      position: { x: 100, y: 100 },
    });
    const right = updateWorkflowNodeConfig(left, "n1", { prompt: "Hello" });
    const diff = diffWorkflowDocuments(left, right);
    expect(diff.modifiedNodes).toHaveLength(1);
    expect(diff.modifiedNodes[0].changes).toHaveLength(1);
    expect(diff.modifiedNodes[0].changes[0].field).toBe("config.prompt");
  });

  it("detects title changes", () => {
    let left = createStarterWorkflowDocument({ id: "wf1", title: "Test" });
    left = addWorkflowNode(left, {
      id: "n1",
      type: "textPrompt",
      position: { x: 100, y: 100 },
    });
    const right = {
      ...left,
      nodes: left.nodes.map((n) =>
        n.id === "n1" ? { ...n, title: "Renamed" } : n,
      ),
    };
    const diff = diffWorkflowDocuments(left, right);
    expect(diff.modifiedNodes).toHaveLength(1);
    expect(diff.modifiedNodes[0].changes[0].field).toBe("title");
  });

  it("counts unchanged nodes and edges", () => {
    const doc = createStarterWorkflowDocument({ id: "wf1", title: "Test" });
    const diff = diffWorkflowDocuments(doc, doc);
    expect(diff.unchangedNodes).toBe(doc.nodes.length);
    expect(diff.unchangedEdges).toBe(doc.edges.length);
    expect(diff.addedNodes).toHaveLength(0);
    expect(diff.removedNodes).toHaveLength(0);
  });
});
