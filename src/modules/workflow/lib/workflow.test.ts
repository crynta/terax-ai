import { describe, expect, it } from "vitest";
import { executeWorkflowStep, executeWorkflowUntilBlocked } from "./execution";
import {
  canConnectReactFlowEdge,
  normalizeWorkflowReactFlowEdge,
  toReactFlowElements,
  updateWorkflowDocumentFromReactFlow,
} from "./reactFlowAdapter";
import {
  addWorkflowNode,
  clearWorkflowCanvas,
  createStarterWorkflowDocument,
  createWorkflowNode,
  duplicateWorkflowNode,
  nextWorkflowNodeId,
  parseWorkflowDocumentJson,
  removeWorkflowNode,
  serializeWorkflowDocument,
  serializeWorkflowDocumentForPersistence,
  updateWorkflowNodeConfig,
  validateWorkflowDocument,
  WORKFLOW_DOCUMENT_VERSION,
  type WorkflowDocument,
} from "./schema";

describe("workflow document schema", () => {
  it("creates a starter media workflow with terminal support", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });

    expect(document).toMatchObject({
      id: "wf_1",
      title: "Draft",
      version: WORKFLOW_DOCUMENT_VERSION,
    });
    expect(document.artifacts).toEqual([]);
    expect(document.nodes.map((node) => node.type)).toEqual([
      "textPrompt",
      "imageGeneration",
      "output",
      "terminal",
    ]);
    expect(document.edges).toEqual([
      {
        id: "edge_prompt_image",
        sourceNodeId: "node_prompt",
        sourcePortId: "text",
        targetNodeId: "node_image",
        targetPortId: "prompt",
      },
      {
        id: "edge_image_output",
        sourceNodeId: "node_image",
        sourcePortId: "image",
        targetNodeId: "node_output",
        targetPortId: "media",
      },
    ]);
  });

  it("rejects duplicate ids and edges pointing at missing nodes", () => {
    const document: WorkflowDocument = {
      id: "wf_bad",
      title: "Bad graph",
      version: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      variables: [],
      artifacts: [],
      nodes: [
        {
          id: "node_a",
          type: "textPrompt",
          title: "Prompt A",
          position: { x: 0, y: 0 },
          size: { width: 240, height: 120 },
          inputs: [],
          outputs: [{ id: "text", type: "text", label: "Text" }],
          config: {},
          runtimeState: { status: "idle" },
          uiState: {},
        },
        {
          id: "node_a",
          type: "textPrompt",
          title: "Prompt B",
          position: { x: 320, y: 0 },
          size: { width: 240, height: 120 },
          inputs: [],
          outputs: [{ id: "text", type: "text", label: "Text" }],
          config: {},
          runtimeState: { status: "idle" },
          uiState: {},
        },
      ],
      edges: [
        {
          id: "edge_missing",
          sourceNodeId: "node_a",
          sourcePortId: "text",
          targetNodeId: "node_missing",
          targetPortId: "prompt",
        },
      ],
    };

    expect(validateWorkflowDocument(document)).toEqual([
      "Duplicate node id: node_a",
      "Edge edge_missing targets missing node node_missing",
    ]);
  });

  it("creates typed workflow nodes for the canvas palette", () => {
    expect(
      createWorkflowNode({
        id: "node_video_1",
        type: "videoGeneration",
        position: { x: 10, y: 20 },
      }),
    ).toMatchObject({
      id: "node_video_1",
      type: "videoGeneration",
      title: "Video Generation",
      inputs: [
        { id: "prompt", type: "text" },
        { id: "image", type: "image" },
      ],
      outputs: [{ id: "video", type: "video" }],
    });
  });

  it("creates shell nodes with visible cwd and timeout config defaults", () => {
    expect(
      createWorkflowNode({
        id: "node_shell_1",
        type: "shellCommand",
        position: { x: 10, y: 20 },
      }),
    ).toMatchObject({
      config: { command: "", cwd: "", requiresApproval: true, timeoutSecs: 30 },
    });
  });

  it("creates HTTP, file, and browser automation nodes", () => {
    expect(
      createWorkflowNode({
        id: "node_http_1",
        type: "httpRequest",
        position: { x: 10, y: 20 },
      }),
    ).toMatchObject({
      title: "HTTP Request",
      inputs: [
        { id: "body", type: "json" },
        { id: "text", type: "text" },
      ],
      outputs: [{ id: "response", type: "json" }],
      config: { method: "GET", url: "" },
    });
    expect(
      createWorkflowNode({
        id: "node_file_1",
        type: "fileOperation",
        position: { x: 10, y: 20 },
      }),
    ).toMatchObject({
      title: "File Operation",
      config: { operation: "read", path: "", requiresApproval: true },
    });
    expect(
      createWorkflowNode({
        id: "node_browser_1",
        type: "browserAutomation",
        position: { x: 10, y: 20 },
      }),
    ).toMatchObject({
      title: "Browser Automation",
      config: { url: "", instructions: "", requiresApproval: true },
    });
  });

  it("appends workflow nodes with generated IDs", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });
    const next = addWorkflowNode(document, {
      id: nextWorkflowNodeId(document, "audioGeneration"),
      type: "audioGeneration",
      position: { x: 120, y: 480 },
    });

    expect(next.nodes[next.nodes.length - 1]).toMatchObject({
      id: "node_audioGeneration_1",
      type: "audioGeneration",
      position: { x: 120, y: 480 },
    });
    expect(validateWorkflowDocument(next)).toEqual([]);
  });

  it("duplicates workflow nodes with clean runtime state", () => {
    const executed = executeWorkflowStep(
      createStarterWorkflowDocument({ id: "wf_1", title: "Draft" }),
    );
    const next = duplicateWorkflowNode(executed, "node_prompt");
    const duplicate = next.nodes.find(
      (node) => node.id === "node_textPrompt_1",
    );

    expect(duplicate).toMatchObject({
      id: "node_textPrompt_1",
      type: "textPrompt",
      title: "Prompt Copy",
      position: { x: 128, y: 168 },
      size: { width: 260, height: 150 },
      config: { prompt: "A cinematic robot pianist in a neon studio" },
      runtimeState: { status: "idle" },
      uiState: {},
    });
    expect(duplicate?.inputs).toEqual([]);
    expect(duplicate?.outputs).toEqual([
      { id: "text", type: "text", label: "Text" },
    ]);
    expect(next.edges).toEqual(executed.edges);
    expect(next.artifacts).toBe(executed.artifacts);
    expect(validateWorkflowDocument(next)).toEqual([]);
  });

  it("ignores duplicate requests for unknown nodes", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });

    expect(duplicateWorkflowNode(document, "node_missing")).toBe(document);
  });

  it("removes workflow nodes with incident edges and stale artifacts", () => {
    const document: WorkflowDocument = {
      ...createStarterWorkflowDocument({ id: "wf_1", title: "Draft" }),
      artifacts: [
        {
          id: "artifact_image",
          nodeId: "node_image",
          portId: "image",
          type: "image",
          label: "Image",
          preview: "image-preview",
        },
      ],
      nodes: createStarterWorkflowDocument({
        id: "wf_1",
        title: "Draft",
      }).nodes.map((node) =>
        node.id === "node_output"
          ? {
              ...node,
              runtimeState: {
                status: "completed",
                artifactIds: ["artifact_image"],
              },
            }
          : node,
      ),
    };

    const next = removeWorkflowNode(document, "node_image");

    expect(next.nodes.map((node) => node.id)).not.toContain("node_image");
    expect(next.edges).toEqual([]);
    expect(next.artifacts).toEqual([]);
    expect(
      next.nodes.find((node) => node.id === "node_output")?.runtimeState,
    ).toEqual({ status: "completed" });
    expect(validateWorkflowDocument(next)).toEqual([]);
  });

  it("clears the workflow canvas while preserving document identity", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });
    const next = clearWorkflowCanvas(document);

    expect(next).toMatchObject({
      id: "wf_1",
      title: "Draft",
      version: WORKFLOW_DOCUMENT_VERSION,
      viewport: document.viewport,
      variables: document.variables,
    });
    expect(next.nodes).toEqual([]);
    expect(next.edges).toEqual([]);
    expect(next.artifacts).toEqual([]);
    expect(validateWorkflowDocument(next)).toEqual([]);
  });

  it("serializes workflow documents as formatted JSON", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });
    const json = serializeWorkflowDocument(document);

    expect(json).toContain('\n  "id": "wf_1"');
    expect(JSON.parse(json)).toMatchObject({
      id: "wf_1",
      title: "Draft",
      version: 1,
      nodes: expect.any(Array),
      edges: expect.any(Array),
    });
  });

  it("serializes workflow persistence snapshots without runtime state", () => {
    const executed = executeWorkflowUntilBlocked(
      createStarterWorkflowDocument({ id: "wf_safe", title: "Safe" }),
    );
    const withProgress: WorkflowDocument = {
      ...executed,
      nodes: executed.nodes.map((node) =>
        node.id === "node_image"
          ? {
              ...node,
              runtimeState: {
                status: "running",
                message: "Rendering",
                progress: 0.5,
                artifactIds: ["wf_safe:node_image:image"],
              },
            }
          : node,
      ),
    };

    const json = serializeWorkflowDocumentForPersistence(withProgress);
    const persisted = JSON.parse(json) as WorkflowDocument;

    expect(persisted.artifacts).toEqual([]);
    expect(persisted.nodes.map((node) => node.runtimeState)).toEqual([
      { status: "idle" },
      { status: "idle" },
      { status: "idle" },
      { status: "idle" },
    ]);
  });

  it("parses valid workflow JSON into a runtime-safe document", () => {
    const executed = executeWorkflowStep(
      createStarterWorkflowDocument({ id: "wf_1", title: "Draft" }),
    );
    const parsed = parseWorkflowDocumentJson(
      serializeWorkflowDocument(executed),
    );

    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) throw new Error(parsed.errors.join(", "));
    expect(parsed.document).toMatchObject({
      id: "wf_1",
      title: "Draft",
      version: 1,
      artifacts: [],
    });
    expect(parsed.document.nodes.map((node) => node.runtimeState)).toEqual([
      { status: "idle" },
      { status: "idle" },
      { status: "idle" },
      { status: "idle" },
    ]);
    expect(validateWorkflowDocument(parsed.document)).toEqual([]);
  });

  it("rejects workflow JSON from newer schema versions", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_future",
      title: "Future",
    });

    expect(
      parseWorkflowDocumentJson(JSON.stringify({ ...document, version: 999 })),
    ).toEqual({
      ok: false,
      errors: [
        `Workflow version 999 is newer than supported version ${WORKFLOW_DOCUMENT_VERSION}`,
      ],
    });
  });

  it("migrates minimal legacy workflow JSON into the current schema", () => {
    const parsed = parseWorkflowDocumentJson(
      JSON.stringify({
        id: "wf_legacy",
        title: "Legacy",
        nodes: [
          {
            id: "node_prompt",
            type: "textPrompt",
            position: { x: 24, y: 48 },
          },
        ],
        edges: [],
      }),
    );

    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) throw new Error(parsed.errors.join(", "));
    expect(parsed.document).toMatchObject({
      id: "wf_legacy",
      title: "Legacy",
      version: 1,
      artifacts: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      variables: [],
    });
    expect(parsed.document.nodes[0]).toMatchObject({
      id: "node_prompt",
      type: "textPrompt",
      title: "Prompt",
      runtimeState: { status: "idle" },
      uiState: {},
      outputs: [{ id: "text", type: "text", label: "Text" }],
    });
    expect(validateWorkflowDocument(parsed.document)).toEqual([]);
  });

  it("rejects malformed or invalid workflow JSON", () => {
    expect(parseWorkflowDocumentJson("not json")).toEqual({
      ok: false,
      errors: ["Workflow JSON is not valid JSON"],
    });

    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });
    const invalidGraph = {
      ...document,
      edges: [
        {
          id: "edge_missing",
          sourceNodeId: "node_prompt",
          sourcePortId: "text",
          targetNodeId: "node_missing",
          targetPortId: "prompt",
        },
      ],
    };

    expect(parseWorkflowDocumentJson(JSON.stringify(invalidGraph))).toEqual({
      ok: false,
      errors: ["Edge edge_missing targets missing node node_missing"],
    });
  });

  it("updates node config while preserving graph structure", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });
    const next = updateWorkflowNodeConfig(document, "node_prompt", {
      prompt: "A glass spaceship over Istanbul",
    });

    expect(
      next.nodes.find((node) => node.id === "node_prompt")?.config,
    ).toMatchObject({ prompt: "A glass spaceship over Istanbul" });
    expect(next.edges).toBe(document.edges);
    expect(
      document.nodes.find((node) => node.id === "node_prompt")?.config,
    ).toMatchObject({ prompt: "A cinematic robot pianist in a neon studio" });
  });

  it("ignores config updates for unknown nodes", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });

    expect(
      updateWorkflowNodeConfig(document, "node_missing", { prompt: "x" }),
    ).toBe(document);
  });

  it("maps React Flow node moves back into the Terax document", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });
    const flow = toReactFlowElements(document);
    const next = updateWorkflowDocumentFromReactFlow(document, {
      nodes: flow.nodes.map((node) =>
        node.id === "node_prompt"
          ? {
              ...node,
              position: { x: 140, y: 220 },
              width: 320,
              height: 180,
            }
          : node,
      ),
      edges: flow.edges,
    });

    expect(next.nodes.find((node) => node.id === "node_prompt")).toMatchObject({
      position: { x: 140, y: 220 },
      size: { width: 320, height: 180 },
    });
    expect(
      document.nodes.find((node) => node.id === "node_prompt")?.position,
    ).toEqual({ x: 80, y: 120 });
  });

  it("maps React Flow viewport changes back into the Terax document", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });
    const flow = toReactFlowElements(document);
    const next = updateWorkflowDocumentFromReactFlow(document, {
      nodes: flow.nodes,
      edges: flow.edges,
      viewport: { x: -240, y: 96, zoom: 0.65 },
    });

    expect(next.viewport).toEqual({ x: -240, y: 96, zoom: 0.65 });
    expect(validateWorkflowDocument(next)).toEqual([]);
  });

  it("persists React Flow node deletion and prunes connected edges", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });
    const flow = toReactFlowElements(document);
    const next = updateWorkflowDocumentFromReactFlow(document, {
      nodes: flow.nodes.filter((node) => node.id !== "node_image"),
      edges: flow.edges,
    });

    expect(next.nodes.map((node) => node.id)).toEqual([
      "node_prompt",
      "node_output",
      "node_terminal",
    ]);
    expect(next.edges).toEqual([]);
    expect(validateWorkflowDocument(next)).toEqual([]);
  });

  it("prunes stale artifacts and runtime artifact references for deleted nodes", () => {
    const executed = executeWorkflowStep(
      executeWorkflowStep(
        executeWorkflowStep(
          createStarterWorkflowDocument({ id: "wf_1", title: "Draft" }),
        ),
      ),
    );
    const flow = toReactFlowElements(executed);
    const next = updateWorkflowDocumentFromReactFlow(executed, {
      nodes: flow.nodes.filter((node) => node.id !== "node_image"),
      edges: flow.edges,
    });

    expect(next.artifacts.map((artifact) => artifact.id)).toEqual([
      "wf_1:node_prompt:text",
      "wf_1:node_terminal:terminal",
    ]);
    expect(
      next.nodes.find((node) => node.id === "node_output")?.runtimeState
        .artifactIds,
    ).toBeUndefined();
  });

  it("maps valid React Flow edge edits back into the Terax document", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });
    const flow = toReactFlowElements(document);
    const next = updateWorkflowDocumentFromReactFlow(document, {
      nodes: flow.nodes,
      edges: [
        {
          id: "edge_prompt_image_custom",
          source: "node_prompt",
          sourceHandle: "text",
          target: "node_image",
          targetHandle: "prompt",
        },
        {
          id: "edge_invalid_type",
          source: "node_prompt",
          sourceHandle: "text",
          target: "node_output",
          targetHandle: "media",
        },
      ],
    });

    expect(next.edges).toEqual([
      {
        id: "edge_prompt_image_custom",
        sourceNodeId: "node_prompt",
        sourcePortId: "text",
        targetNodeId: "node_image",
        targetPortId: "prompt",
      },
    ]);
    expect(validateWorkflowDocument(next)).toEqual([]);
  });

  it("normalizes reversed React Flow connection gestures", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });

    const normalized = normalizeWorkflowReactFlowEdge(document, {
      id: "edge_reversed_drag",
      source: "node_image",
      sourceHandle: "prompt",
      target: "node_prompt",
      targetHandle: "text",
    });

    expect(normalized).toEqual({
      id: "edge_reversed_drag",
      source: "node_prompt",
      sourceHandle: "text",
      target: "node_image",
      targetHandle: "prompt",
    });
    expect(
      canConnectReactFlowEdge(document, {
        id: "edge_reversed_drag",
        source: "node_image",
        sourceHandle: "prompt",
        target: "node_prompt",
        targetHandle: "text",
      }),
    ).toBe(true);
  });

  it("maps reversed React Flow edge edits back into the Terax document", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });
    const flow = toReactFlowElements(document);
    const next = updateWorkflowDocumentFromReactFlow(document, {
      nodes: flow.nodes,
      edges: [
        {
          id: "edge_reversed_drag",
          source: "node_image",
          sourceHandle: "prompt",
          target: "node_prompt",
          targetHandle: "text",
        },
      ],
    });

    expect(next.edges).toEqual([
      {
        id: "edge_reversed_drag",
        sourceNodeId: "node_prompt",
        sourcePortId: "text",
        targetNodeId: "node_image",
        targetPortId: "prompt",
      },
    ]);
    expect(validateWorkflowDocument(next)).toEqual([]);
  });

  it("maps the Terax document model into React Flow nodes and edges", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });
    const flow = toReactFlowElements(document);

    expect(flow.nodes[0]).toMatchObject({
      id: "node_prompt",
      type: "workflowNode",
      position: { x: 80, y: 120 },
      data: {
        workflowNodeId: "node_prompt",
        nodeType: "textPrompt",
        title: "Prompt",
      },
    });
    expect(flow.edges[0]).toMatchObject({
      id: "edge_prompt_image",
      source: "node_prompt",
      sourceHandle: "text",
      target: "node_image",
      targetHandle: "prompt",
    });
  });
});

