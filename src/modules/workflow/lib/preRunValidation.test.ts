import { describe, expect, it } from "vitest";
import { preRunValidation } from "./preRunValidation";
import {
  createStarterWorkflowDocument,
  addWorkflowNode,
} from "./schema";

describe("workflow pre-run validation", () => {
  it("reports no issues for a valid starter document", () => {
    const doc = createStarterWorkflowDocument({
      id: "wf_valid",
      title: "Valid",
    });
    const issues = preRunValidation(doc);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });

  it("reports missing URL for HTTP node", () => {
    const doc = addWorkflowNode(
      createStarterWorkflowDocument({ id: "wf_http", title: "HTTP" }),
      { id: "node_http", type: "httpRequest", position: { x: 200, y: 80 } },
    );
    const issues = preRunValidation(doc);
    const httpWarnings = issues.filter(
      (i) => i.message.includes("URL not configured"),
    );
    expect(httpWarnings.length).toBe(1);
  });

  it("reports missing variable name", () => {
    const doc = addWorkflowNode(
      createStarterWorkflowDocument({ id: "wf_var", title: "Var" }),
      { id: "node_setvar", type: "setVariable", position: { x: 200, y: 80 } },
    );
    const issues = preRunValidation(doc);
    const varWarnings = issues.filter(
      (i) => i.message.includes("Variable name not set"),
    );
    expect(varWarnings.length).toBe(1);
  });

  it("reports disconnected nodes with inputs", () => {
    const doc = addWorkflowNode(
      createStarterWorkflowDocument({ id: "wf_disc", title: "Disc" }),
      { id: "node_agent", type: "agent", position: { x: 200, y: 80 } },
    );
    const issues = preRunValidation(doc);
    const discIssues = issues.filter((i) =>
      i.message.includes("has no connections"),
    );
    expect(discIssues.length).toBeGreaterThanOrEqual(1);
  });

  it("reports unsafe nodes count", () => {
    const doc = addWorkflowNode(
      createStarterWorkflowDocument({ id: "wf_unsafe", title: "Unsafe" }),
      { id: "node_shell", type: "shellCommand", position: { x: 200, y: 80 } },
    );
    const issues = preRunValidation(doc);
    const unsafeInfo = issues.filter((i) =>
      i.message.includes("require approval"),
    );
    expect(unsafeInfo.length).toBe(1);
  });
});
