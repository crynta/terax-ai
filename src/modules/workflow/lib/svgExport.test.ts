import { describe, expect, it } from "vitest";
import { workflowToSvg } from "./svgExport";
import { createStarterWorkflowDocument, addWorkflowNode } from "./schema";

describe("workflowToSvg", () => {
  it("generates valid SVG for empty workflow", () => {
    const doc = createStarterWorkflowDocument({ id: "wf1", title: "Empty" });
    const svg = workflowToSvg(doc);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("includes node titles in SVG", () => {
    let doc = createStarterWorkflowDocument({ id: "wf1", title: "Test" });
    doc = addWorkflowNode(doc, {
      id: "n1",
      type: "textPrompt",
      position: { x: 100, y: 100 },
    });
    const svg = workflowToSvg(doc);
    expect(svg).toContain("Prompt");
  });

  it("includes edges as lines", () => {
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
    doc = {
      ...doc,
      edges: [
        {
          id: "e1",
          sourceNodeId: "n1",
          sourcePortId: "text",
          targetNodeId: "n2",
          targetPortId: "input",
        },
      ],
    };
    const svg = workflowToSvg(doc);
    expect(svg).toContain("<line");
    expect(svg).toContain("<polygon");
  });

  it("escapes XML special characters in titles", () => {
    let doc = createStarterWorkflowDocument({ id: "wf1", title: "A<B>&C" });
    doc = addWorkflowNode(doc, {
      id: "n1",
      type: "textPrompt",
      position: { x: 100, y: 100 },
    });
    doc = {
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.id === "n1" ? { ...n, title: "Test <&>" } : n,
      ),
    };
    const svg = workflowToSvg(doc);
    expect(svg).toContain("&lt;");
    expect(svg).toContain("&amp;");
    expect(svg).not.toContain("Test <&>");
  });
});
