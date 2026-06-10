import { describe, expect, it } from "vitest";
import {
  addWorkflowNode,
  createStarterWorkflowDocument,
  updateWorkflowNodeConfig,
  type WorkflowEdge,
} from "./schema";
import { executeWorkflowUntilBlocked } from "./execution";

describe("workflow E2E chain", () => {
  it("runs a Prompt → Transform → If → Output chain", () => {
    let doc = createStarterWorkflowDocument({
      id: "wf_e2e_chain",
      title: "E2E Chain",
    });

    doc = addWorkflowNode(doc, { id: "prompt", type: "textPrompt", position: { x: 100, y: 100 } });
    doc = updateWorkflowNodeConfig(doc, "prompt", { prompt: "Hello world" });

    doc = addWorkflowNode(doc, { id: "transform", type: "textTransform", position: { x: 300, y: 100 } });
    doc = updateWorkflowNodeConfig(doc, "transform", { template: "Transformed: {{input}}" });

    doc = addWorkflowNode(doc, { id: "if", type: "if", position: { x: 500, y: 100 } });
    doc = updateWorkflowNodeConfig(doc, "if", { operator: "contains", value: "Transformed" });

    doc = addWorkflowNode(doc, { id: "output", type: "output", position: { x: 700, y: 100 } });

    // textPrompt output port ID is "text", textTransform output is "text"
    const edges: WorkflowEdge[] = [
      { id: "e1", sourceNodeId: "prompt", sourcePortId: "text", targetNodeId: "transform", targetPortId: "text" },
      { id: "e2", sourceNodeId: "transform", sourcePortId: "text", targetNodeId: "if", targetPortId: "text" },
      { id: "e3", sourceNodeId: "if", sourcePortId: "true", targetNodeId: "output", targetPortId: "text" },
    ];
    doc = { ...doc, edges };

    const result = executeWorkflowUntilBlocked(doc);

    const promptNode = result.nodes.find((n) => n.id === "prompt");
    const transformNode = result.nodes.find((n) => n.id === "transform");
    const ifNode = result.nodes.find((n) => n.id === "if");
    const outputNode = result.nodes.find((n) => n.id === "output");

    expect(promptNode?.runtimeState.status).toBe("completed");
    expect(transformNode?.runtimeState.status).toBe("completed");
    expect(ifNode?.runtimeState.status).toBe("completed");
    expect(outputNode?.runtimeState.status).toBe("completed");

    const promptArts = result.artifacts.filter((a) => (promptNode?.runtimeState.artifactIds ?? []).includes(a.id));
    expect(promptArts[0]?.value).toContain("Hello world");

    const transformArts = result.artifacts.filter((a) => (transformNode?.runtimeState.artifactIds ?? []).includes(a.id));
    expect(transformArts[0]?.value).toContain("Transformed");
    expect(transformArts[0]?.value).toContain("Hello world");

    const ifArts = result.artifacts.filter((a) => (ifNode?.runtimeState.artifactIds ?? []).includes(a.id));
    expect(ifArts.find((a) => a.portId === "true")).toBeDefined();
  });

  it("runs a Set Variable → Get Variable chain", () => {
    let doc = createStarterWorkflowDocument({ id: "wf_e2e_vars", title: "E2E Variables" });

    doc = addWorkflowNode(doc, { id: "prompt", type: "textPrompt", position: { x: 100, y: 100 } });
    doc = updateWorkflowNodeConfig(doc, "prompt", { prompt: "Alice" });

    doc = addWorkflowNode(doc, { id: "setvar", type: "setVariable", position: { x: 300, y: 100 } });
    doc = updateWorkflowNodeConfig(doc, "setvar", { variableName: "userName" });

    doc = addWorkflowNode(doc, { id: "getvar", type: "getVariable", position: { x: 500, y: 100 } });
    doc = updateWorkflowNodeConfig(doc, "getvar", { variableName: "userName" });

    const edges: WorkflowEdge[] = [
      { id: "e1", sourceNodeId: "prompt", sourcePortId: "text", targetNodeId: "setvar", targetPortId: "text" },
    ];
    doc = { ...doc, edges };

    const result = executeWorkflowUntilBlocked(doc);

    const userNameVar = result.variables.find((v) => v.name === "userName");
    expect(userNameVar).toBeDefined();
    expect(userNameVar?.value).toBe("Alice");

    const getVarNode = result.nodes.find((n) => n.id === "getvar");
    expect(getVarNode?.runtimeState.status).toBe("completed");
  });

  it("runs a Switch node routing to correct branch", () => {
    let doc = createStarterWorkflowDocument({ id: "wf_e2e_switch", title: "E2E Switch" });

    doc = addWorkflowNode(doc, { id: "input", type: "textPrompt", position: { x: 100, y: 100 } });
    doc = updateWorkflowNodeConfig(doc, "input", { prompt: "status: ok" });

    doc = addWorkflowNode(doc, { id: "switch", type: "switch", position: { x: 300, y: 100 } });
    doc = updateWorkflowNodeConfig(doc, "switch", {
      cases: "ok\nerror",
      operator: "contains",
    });

    doc = addWorkflowNode(doc, { id: "output_ok", type: "output", position: { x: 500, y: 60 } });
    doc = addWorkflowNode(doc, { id: "output_err", type: "output", position: { x: 500, y: 140 } });

    const edges: WorkflowEdge[] = [
      { id: "e1", sourceNodeId: "input", sourcePortId: "text", targetNodeId: "switch", targetPortId: "input" },
      { id: "e2", sourceNodeId: "switch", sourcePortId: "case_1", targetNodeId: "output_ok", targetPortId: "text" },
      { id: "e3", sourceNodeId: "switch", sourcePortId: "case_2", targetNodeId: "output_err", targetPortId: "text" },
    ];
    doc = { ...doc, edges };

    const result = executeWorkflowUntilBlocked(doc);

    const switchNode = result.nodes.find((n) => n.id === "switch");
    expect(switchNode?.runtimeState.status).toBe("completed");

    const outputOk = result.nodes.find((n) => n.id === "output_ok");
    const outputErr = result.nodes.find((n) => n.id === "output_err");

    expect(outputOk?.runtimeState.status).toBe("completed");
    expect(outputErr?.runtimeState.status).toBe("idle");
  });

  it("runs a Merge node combining two text inputs", () => {
    let doc = createStarterWorkflowDocument({ id: "wf_e2e_merge", title: "E2E Merge" });

    doc = addWorkflowNode(doc, { id: "p1", type: "textPrompt", position: { x: 100, y: 60 } });
    doc = updateWorkflowNodeConfig(doc, "p1", { prompt: "First" });
    doc = addWorkflowNode(doc, { id: "p2", type: "textPrompt", position: { x: 100, y: 140 } });
    doc = updateWorkflowNodeConfig(doc, "p2", { prompt: "Second" });

    doc = addWorkflowNode(doc, { id: "merge", type: "merge", position: { x: 300, y: 100 } });
    doc = updateWorkflowNodeConfig(doc, "merge", { separator: ", " });

    doc = addWorkflowNode(doc, { id: "output", type: "output", position: { x: 500, y: 100 } });

    const edges: WorkflowEdge[] = [
      { id: "e1", sourceNodeId: "p1", sourcePortId: "text", targetNodeId: "merge", targetPortId: "text_a" },
      { id: "e2", sourceNodeId: "p2", sourcePortId: "text", targetNodeId: "merge", targetPortId: "text_b" },
      { id: "e3", sourceNodeId: "merge", sourcePortId: "text", targetNodeId: "output", targetPortId: "text" },
    ];
    doc = { ...doc, edges };

    const result = executeWorkflowUntilBlocked(doc);

    const mergeNode = result.nodes.find((n) => n.id === "merge");
    expect(mergeNode?.runtimeState.status).toBe("completed");

    const mergeArts = result.artifacts.filter((a) => (mergeNode?.runtimeState.artifactIds ?? []).includes(a.id));
    expect(mergeArts[0]?.value).toContain("First");
    expect(mergeArts[0]?.value).toContain("Second");
    expect(typeof mergeArts[0]?.value).toBe("string");
  });
});
