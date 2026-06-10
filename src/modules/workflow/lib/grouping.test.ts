import { describe, expect, it } from "vitest";
import { toggleGroupCollapse, collapsedGroupChildIds, documentVisibleNodes, documentVisibleEdges } from "./grouping";
import { createStarterWorkflowDocument, addWorkflowNode, type WorkflowDocument } from "./schema";

describe("workflow grouping", () => {
  it("toggles group collapsed state and resizes", () => {
    const base = createStarterWorkflowDocument({ id: "wf_grp", title: "Group" });
    const withGroup = addWorkflowNode(base, {
      id: "node_group_1",
      type: "group",
      position: { x: 0, y: 0 },
    });
    const configured = {
      ...withGroup,
      nodes: withGroup.nodes.map((n) =>
        n.id === "node_group_1"
          ? { ...n, uiState: { childNodeIds: ["node_prompt", "node_image"] } }
          : n,
      ),
    };
    // Collapse
    const collapsed = toggleGroupCollapse(configured, "node_group_1");
    const group = collapsed.nodes.find((n) => n.id === "node_group_1");
    expect(group?.config.collapsed).toBe(true);
    expect(group?.size.height).toBe(80);

    // Expand
    const expanded = toggleGroupCollapse(collapsed, "node_group_1");
    const group2 = expanded.nodes.find((n) => n.id === "node_group_1");
    expect(group2?.config.collapsed).toBe(false);
    expect(group2?.size.height).toBe(300);
  });

  it("hides child nodes when group is collapsed", () => {
    const base = createStarterWorkflowDocument({ id: "wf_hide", title: "Hide" });
    const withGroup = addWorkflowNode(base, {
      id: "node_group_1",
      type: "group",
      position: { x: 0, y: 0 },
    });
    const doc: WorkflowDocument = {
      ...withGroup,
      nodes: withGroup.nodes.map((n) =>
        n.id === "node_group_1"
          ? {
              ...n,
              config: { collapsed: true },
              uiState: { childNodeIds: ["node_prompt"] },
            }
          : n,
      ),
    };
    const hidden = collapsedGroupChildIds(doc);
    expect(hidden.has("node_prompt")).toBe(true);
    expect(hidden.has("node_image")).toBe(false);

    const visible = documentVisibleNodes(doc);
    expect(visible.find((n) => n.id === "node_prompt")).toBeUndefined();
    expect(visible.find((n) => n.id === "node_image")).toBeDefined();
  });

  it("filters edges connecting to hidden nodes", () => {
    const base = createStarterWorkflowDocument({ id: "wf_edges", title: "Edges" });
    const doc: WorkflowDocument = {
      ...base,
      nodes: [
        ...base.nodes,
        {
          id: "node_group_1",
          type: "group",
          title: "Group",
          position: { x: 0, y: 0 },
          size: { width: 400, height: 300 },
          inputs: [],
          outputs: [],
          config: { collapsed: true },
          uiState: { childNodeIds: ["node_prompt"] },
          runtimeState: { status: "idle" },
        },
      ],
      edges: [
        {
          id: "edge_hidden",
          sourceNodeId: "node_prompt",
          sourcePortId: "text",
          targetNodeId: "node_image",
          targetPortId: "prompt",
        },
        {
          id: "edge_visible",
          sourceNodeId: "node_image",
          sourcePortId: "image",
          targetNodeId: "node_terminal",
          targetPortId: "command",
        },
      ],
    };
    const visibleEdges = documentVisibleEdges(doc);
    expect(visibleEdges.length).toBe(1);
    expect(visibleEdges[0].id).toBe("edge_visible");
  });
});
