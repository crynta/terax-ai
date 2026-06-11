import { describe, expect, it } from "vitest";
import {
  extractExpressionReferences,
  resolveWorkflowConfigExpressions,
  resolveWorkflowExpressions,
} from "./expressions";
import { createStarterWorkflowDocument, type WorkflowDocument } from "./schema";

describe("workflow expressions", () => {
  it("resolves variable references", () => {
    const doc: WorkflowDocument = {
      ...createStarterWorkflowDocument({ id: "wf_expr", title: "Expr" }),
      variables: [
        { id: "var_greeting", name: "greeting", type: "text", value: "Hello" },
      ],
    };
    expect(
      resolveWorkflowExpressions("Say: {{variables.greeting}}!", doc),
    ).toBe("Say: Hello!");
  });

  it("resolves node artifact references", () => {
    const doc: WorkflowDocument = {
      ...createStarterWorkflowDocument({ id: "wf_expr2", title: "Expr" }),
      nodes: [
        {
          id: "node_a",
          type: "textPrompt",
          title: "Source",
          position: { x: 0, y: 0 },
          size: { width: 260, height: 150 },
          inputs: [],
          outputs: [{ id: "text", type: "text", label: "Text" }],
          config: { prompt: "world" },
          uiState: {},
          runtimeState: {
            status: "completed",
            artifactIds: ["wf_expr2:node_a:text"],
          },
        },
      ],
      artifacts: [
        {
          id: "wf_expr2:node_a:text",
          nodeId: "node_a",
          portId: "text",
          type: "text",
          label: "Source",
          preview: "world",
          value: "world",
        },
      ],
    };
    expect(resolveWorkflowExpressions("Hello {{node.node_a}}!", doc)).toBe(
      "Hello world!",
    );
    expect(resolveWorkflowExpressions("Hello {{node.node_a.text}}!", doc)).toBe(
      "Hello world!",
    );
  });

  it("leaves unknown references unchanged", () => {
    const doc = createStarterWorkflowDocument({
      id: "wf_unknown",
      title: "Unknown",
    });
    expect(resolveWorkflowExpressions("{{variables.missing}} stays", doc)).toBe(
      "{{variables.missing}} stays",
    );
  });

  it("resolves config object expressions", () => {
    const doc: WorkflowDocument = {
      ...createStarterWorkflowDocument({ id: "wf_cfg", title: "Cfg" }),
      variables: [
        { id: "var_url", name: "url", type: "text", value: "https://api.test" },
      ],
    };
    const config = resolveWorkflowConfigExpressions(
      { method: "GET", url: "{{variables.url}}/data", count: 5 },
      doc,
    );
    expect(config.method).toBe("GET");
    expect(config.url).toBe("https://api.test/data");
    expect(config.count).toBe(5);
  });

  it("extracts expression references", () => {
    const refs = extractExpressionReferences(
      "{{variables.x}} and {{node.n1.text}} and {{variables.x}}",
    );
    expect(refs).toEqual(["variables.x", "node.n1.text"]);
  });

  it("handles multiple expressions in one string", () => {
    const doc: WorkflowDocument = {
      ...createStarterWorkflowDocument({ id: "wf_multi", title: "Multi" }),
      variables: [
        { id: "var_a", name: "a", type: "text", value: "alpha" },
        { id: "var_b", name: "b", type: "text", value: "beta" },
      ],
    };
    expect(
      resolveWorkflowExpressions("{{variables.a}} + {{variables.b}}", doc),
    ).toBe("alpha + beta");
  });
});
