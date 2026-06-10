import { describe, expect, it } from "vitest";
import {
  addWorkflowNode,
  createStarterWorkflowDocument,
  updateWorkflowNodeConfig,
} from "./schema";
import type { WorkflowEdge } from "./schema";
import { executeWorkflowStep } from "./execution";

describe("delay node execution", () => {
  it("delays async execution", () => {
    let doc = createStarterWorkflowDocument({ id: "wf_delay", title: "Delay" });
    doc = addWorkflowNode(doc, { id: "delay", type: "delay", position: { x: 100, y: 100 } });
    doc = updateWorkflowNodeConfig(doc, "delay", { seconds: 2 });

    const result = executeWorkflowStep(doc);
    const delayNode = result.nodes.find((n) => n.id === "delay");
    expect(delayNode?.runtimeState.status).toBe("completed");

    const artifacts = result.artifacts.filter((a) => a.nodeId === "delay");
    expect(artifacts[0]?.preview).toContain("Delayed 2s");
  });
});

describe("webhook node execution", () => {
  it("produces trigger artifacts", () => {
    let doc = createStarterWorkflowDocument({ id: "wf_webhook", title: "Webhook" });
    doc = addWorkflowNode(doc, { id: "hook", type: "webhook", position: { x: 100, y: 100 } });
    doc = updateWorkflowNodeConfig(doc, "hook", { path: "/api/trigger", method: "POST" });

    const result = executeWorkflowStep(doc);
    const hookNode = result.nodes.find((n) => n.id === "hook");
    expect(hookNode?.runtimeState.status).toBe("completed");

    const artifacts = result.artifacts.filter((a) => a.nodeId === "hook");
    expect(artifacts.length).toBe(3);

    const bodyArtifact = artifacts.find((a) => a.portId === "body");
    expect(bodyArtifact?.type).toBe("json");
    expect(bodyArtifact?.value).toEqual({ trigger: true, path: "/api/trigger" });
  });
});

describe("schedule node execution", () => {
  it("produces a trigger artifact with cron expression", () => {
    let doc = createStarterWorkflowDocument({ id: "wf_sched", title: "Schedule" });
    doc = addWorkflowNode(doc, { id: "sched", type: "schedule", position: { x: 100, y: 100 } });
    doc = updateWorkflowNodeConfig(doc, "sched", { cron: "0 */2 * * *" });

    const result = executeWorkflowStep(doc);
    const schedNode = result.nodes.find((n) => n.id === "sched");
    expect(schedNode?.runtimeState.status).toBe("completed");

    const artifacts = result.artifacts.filter((a) => a.nodeId === "sched");
    expect(artifacts.length).toBe(1);
    expect(artifacts[0]?.preview).toContain("0 */2 * * *");
    expect(artifacts[0]?.portId).toBe("trigger");
    expect(typeof artifacts[0]?.value).toBe("string");
  });
});

describe("expression resolution in control flow", () => {
  it("resolves {{variables.x}} in if condition value", () => {
    let doc = createStarterWorkflowDocument({ id: "wf_expr_if", title: "Expr If" });
    doc = {
      ...doc,
      variables: [
        { id: "v1", name: "target", type: "text", value: "hello" },
      ],
    };
    doc = addWorkflowNode(doc, { id: "prompt", type: "textPrompt", position: { x: 0, y: 0 } });
    doc = updateWorkflowNodeConfig(doc, "prompt", { prompt: "hello world" });
    doc = addWorkflowNode(doc, { id: "if1", type: "if", position: { x: 200, y: 0 } });
    doc = updateWorkflowNodeConfig(doc, "if1", {
      operator: "contains",
      value: "{{variables.target}}",
    });
    const edges: WorkflowEdge[] = [
      { id: "e1", sourceNodeId: "prompt", sourcePortId: "text", targetNodeId: "if1", targetPortId: "input" },
    ];
    doc = { ...doc, edges };

    doc = executeWorkflowStep(doc);
    doc = executeWorkflowStep(doc);

    const artifacts = doc.artifacts.filter((a) => a.nodeId === "if1");
    expect(artifacts[0]?.portId).toBe("true");
  });

  it("resolves {{variables.x}} in switch case patterns", () => {
    let doc = createStarterWorkflowDocument({ id: "wf_expr_sw", title: "Expr Switch" });
    doc = {
      ...doc,
      variables: [
        { id: "v1", name: "pattern", type: "text", value: "ok" },
      ],
    };
    doc = addWorkflowNode(doc, { id: "prompt", type: "textPrompt", position: { x: 0, y: 0 } });
    doc = updateWorkflowNodeConfig(doc, "prompt", { prompt: "status: ok" });
    doc = addWorkflowNode(doc, { id: "sw1", type: "switch", position: { x: 200, y: 0 } });
    doc = updateWorkflowNodeConfig(doc, "sw1", {
      operator: "contains",
      cases: "{{variables.pattern}}\nerror",
    });
    const edges: WorkflowEdge[] = [
      { id: "e1", sourceNodeId: "prompt", sourcePortId: "text", targetNodeId: "sw1", targetPortId: "input" },
    ];
    doc = { ...doc, edges };

    doc = executeWorkflowStep(doc);
    doc = executeWorkflowStep(doc);

    const artifacts = doc.artifacts.filter((a) => a.nodeId === "sw1");
    expect(artifacts[0]?.portId).toBe("case_1");
  });
});
