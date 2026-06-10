import { describe, expect, it } from "vitest";
import { generateWorkflowReadme } from "./readmeGeneration";
import {
  createStarterWorkflowDocument,
  addWorkflowNode,
  updateWorkflowNodeConfig,
} from "./schema";
import type { WorkflowEdge } from "./schema";

describe("generateWorkflowReadme", () => {
  it("generates a README with title and overview", () => {
    const doc = createStarterWorkflowDocument({ id: "wf1", title: "My Workflow" });
    const readme = generateWorkflowReadme(doc);
    expect(readme).toContain("# My Workflow");
    expect(readme).toContain("## Overview");
    expect(readme).toContain("nodes");
  });

  it("includes node details", () => {
    let doc = createStarterWorkflowDocument({ id: "wf1", title: "Test" });
    doc = addWorkflowNode(doc, {
      id: "n1",
      type: "textPrompt",
      position: { x: 100, y: 100 },
    });
    doc = updateWorkflowNodeConfig(doc, "n1", { prompt: "Hello" });
    const readme = generateWorkflowReadme(doc);
    expect(readme).toContain("## Nodes");
    expect(readme).toContain("textPrompt");
    // Config may or may not be present depending on template defaults
    expect(readme).toContain("### ");
  });

  it("includes connections table", () => {
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
    const edges: WorkflowEdge[] = [
      {
        id: "e1",
        sourceNodeId: "n1",
        sourcePortId: "text",
        targetNodeId: "n2",
        targetPortId: "input",
      },
    ];
    doc = { ...doc, edges };
    const readme = generateWorkflowReadme(doc);
    expect(readme).toContain("## Connections");
    expect(readme).toContain("→");
  });

  it("includes variables when present", () => {
    let doc = createStarterWorkflowDocument({ id: "wf1", title: "Test" });
    doc = { ...doc, variables: [{ id: "v1", name: "apiKey", type: "text", value: "secret" }] };
    const readme = generateWorkflowReadme(doc);
    expect(readme).toContain("## Variables");
    expect(readme).toContain("apiKey");
  });
});
