import { describe, expect, it } from "vitest";
import {
  createStarterWorkflowDocument,
  addWorkflowNode,
  renameWorkflowNode,
} from "./schema";

describe("renameWorkflowNode", () => {
  it("renames a node", () => {
    let doc = createStarterWorkflowDocument({ id: "wf1", title: "Test" });
    doc = addWorkflowNode(doc, {
      id: "n1",
      type: "textPrompt",
      position: { x: 100, y: 100 },
    });
    const renamed = renameWorkflowNode(doc, "n1", "My Prompt");
    const node = renamed.nodes.find((n) => n.id === "n1");
    expect(node?.title).toBe("My Prompt");
  });

  it("ignores empty title", () => {
    let doc = createStarterWorkflowDocument({ id: "wf1", title: "Test" });
    doc = addWorkflowNode(doc, {
      id: "n1",
      type: "textPrompt",
      position: { x: 100, y: 100 },
    });
    const original = doc.nodes.find((n) => n.id === "n1")?.title;
    const renamed = renameWorkflowNode(doc, "n1", "   ");
    expect(renamed.nodes.find((n) => n.id === "n1")?.title).toBe(original);
  });

  it("preserves other nodes", () => {
    let doc = createStarterWorkflowDocument({ id: "wf1", title: "Test" });
    doc = addWorkflowNode(doc, {
      id: "n1",
      type: "textPrompt",
      position: { x: 100, y: 100 },
    });
    doc = addWorkflowNode(doc, {
      id: "n2",
      type: "output",
      position: { x: 400, y: 100 },
    });
    const renamed = renameWorkflowNode(doc, "n1", "Renamed");
    expect(renamed.nodes.find((n) => n.id === "n2")).toBeDefined();
  });
});
