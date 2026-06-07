import { describe, expect, it } from "vitest";
import {
  approveWorkflowNode,
  executeWorkflowStep,
  executeWorkflowStepAsync,
  executeWorkflowUntilBlocked,
  getReadyNodeIds,
  rejectWorkflowNode,
  resetWorkflowRuntime,
  startWorkflowStepExecution,
} from "./execution";
import {
  createWorkflowProviderArtifact,
  getWorkflowProviderAdapter,
} from "./providerAdapter";
import {
  addWorkflowNode,
  createStarterWorkflowDocument,
  createWorkflowNode,
  updateWorkflowNodeConfig,
  type WorkflowArtifact,
  type WorkflowDocument,
} from "./schema";

describe("workflow execution planning", () => {
  it("stores placeholder artifacts on the workflow document", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });
    const next = executeWorkflowStep(document);

    expect(next.artifacts).toEqual(
      expect.arrayContaining([
        {
          id: "wf_1:node_prompt:text",
          nodeId: "node_prompt",
          portId: "text",
          type: "text",
          label: "Prompt",
          preview: "A cinematic robot pianist in a neon studio",
        },
        {
          id: "wf_1:node_terminal:terminal",
          nodeId: "node_terminal",
          portId: "terminal",
          type: "terminal",
          label: "Terminal",
          preview: "Interactive terminal session",
        },
      ]),
    );
    expect(document.artifacts).toEqual([]);
  });

  it("selects media provider adapters for generation nodes", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });
    const imageNode = document.nodes.find((node) => node.id === "node_image");
    const promptNode = document.nodes.find((node) => node.id === "node_prompt");

    expect(imageNode && getWorkflowProviderAdapter(imageNode)?.id).toBe(
      "placeholder-media",
    );
    expect(promptNode && getWorkflowProviderAdapter(promptNode)).toBeNull();
  });

  it("creates media artifacts through provider adapters with upstream inputs", () => {
    const promptReady = executeWorkflowStep(
      createStarterWorkflowDocument({ id: "wf_1", title: "Draft" }),
    );
    const imageNode = promptReady.nodes.find(
      (node) => node.id === "node_image",
    );

    expect(
      imageNode && createWorkflowProviderArtifact(promptReady, imageNode),
    ).toMatchObject({
      id: "wf_1:node_image:image",
      nodeId: "node_image",
      portId: "image",
      type: "image",
      label: "Image Generation",
      preview: expect.stringMatching(/^data:image\/svg\+xml;base64,/),
      value: {
        adapterId: "placeholder-media",
        provider: "placeholder",
        model: "image",
        inputArtifactIds: ["wf_1:node_prompt:text"],
      },
    });
  });

  it("starts async provider nodes as running before completion", async () => {
    const document = executeWorkflowStep(
      createStarterWorkflowDocument({ id: "wf_async", title: "Async" }),
    );
    let resolveArtifact: ((artifact: WorkflowArtifact) => void) | undefined;
    const execution = startWorkflowStepExecution(document, {
      createProviderArtifact: async (_document, node) =>
        new Promise<WorkflowArtifact>((resolve) => {
          resolveArtifact = resolve;
        }).then((artifact) => ({ ...artifact, nodeId: node.id })),
    });

    expect(
      execution.document.nodes.find((node) => node.id === "node_image")
        ?.runtimeState,
    ).toMatchObject({ status: "running" });

    resolveArtifact?.({
      id: "wf_async:node_image:image",
      nodeId: "node_image",
      portId: "image",
      type: "image",
      label: "Image Generation",
      preview: "Async image ready",
    });
    const finished = await execution.finished;

    expect(
      finished.nodes.find((node) => node.id === "node_image")?.runtimeState,
    ).toMatchObject({
      status: "completed",
      artifactIds: ["wf_async:node_image:image"],
    });
    expect(finished.artifacts).toContainEqual(
      expect.objectContaining({ preview: "Async image ready" }),
    );
  });

  it("reports async provider progress as running document updates", async () => {
    const document = executeWorkflowStep(
      createStarterWorkflowDocument({
        id: "wf_async_progress",
        title: "Async",
      }),
    );
    const progressUpdates: WorkflowDocument[] = [];

    const finished = await executeWorkflowStepAsync(document, {
      onProgress: (nextDocument) => progressUpdates.push(nextDocument),
      createProviderArtifact: async (_document, node, context) => {
        (
          context as unknown as {
            reportProgress: (progress: {
              message?: string;
              progress?: number;
            }) => void;
          }
        ).reportProgress({ message: "Rendering image", progress: 0.5 });
        return {
          id: "wf_async_progress:node_image:image",
          nodeId: node.id,
          portId: "image",
          type: "image",
          label: node.title,
          preview: "Progress image ready",
        };
      },
    });

    expect(progressUpdates).toHaveLength(1);
    expect(
      progressUpdates[0]?.nodes.find((node) => node.id === "node_image")
        ?.runtimeState,
    ).toMatchObject({
      status: "running",
      message: "Rendering image",
      progress: 0.5,
    });
    expect(
      finished.nodes.find((node) => node.id === "node_image")?.runtimeState,
    ).toMatchObject({
      status: "completed",
      message: "Placeholder image artifact ready",
      artifactIds: ["wf_async_progress:node_image:image"],
    });
  });

  it("passes abort signals to async provider factories", async () => {
    const document = executeWorkflowStep(
      createStarterWorkflowDocument({ id: "wf_async_signal", title: "Async" }),
    );
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;

    const finished = await executeWorkflowStepAsync(document, {
      signal: controller.signal,
      createProviderArtifact: async (_document, node, context) => {
        seenSignal = context.signal;
        return {
          id: "wf_async_signal:node_image:image",
          nodeId: node.id,
          portId: "image",
          type: "image",
          label: node.title,
          preview: "Signal image ready",
        };
      },
    });

    expect(seenSignal).toBe(controller.signal);
    expect(
      finished.nodes.find((node) => node.id === "node_image")?.runtimeState,
    ).toMatchObject({ status: "completed" });
  });

  it("cancels running async provider nodes when aborted", async () => {
    const document = executeWorkflowStep(
      createStarterWorkflowDocument({ id: "wf_async_cancel", title: "Async" }),
    );
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const execution = startWorkflowStepExecution(document, {
      signal: controller.signal,
      createProviderArtifact: async (_document, _node, context) => {
        seenSignal = context.signal;
        return new Promise<WorkflowArtifact>((_resolve, reject) => {
          context.signal?.addEventListener("abort", () => {
            const error = new Error("provider cancelled");
            error.name = "AbortError";
            reject(error);
          });
        });
      },
    });

    expect(
      execution.document.nodes.find((node) => node.id === "node_image")
        ?.runtimeState,
    ).toMatchObject({ status: "running" });

    controller.abort();
    const finished = await execution.finished;

    expect(seenSignal).toBe(controller.signal);
    expect(
      finished.nodes.find((node) => node.id === "node_image")?.runtimeState,
    ).toMatchObject({
      status: "cancelled",
      message: "Execution cancelled",
    });
    expect(
      finished.artifacts.some((artifact) => artifact.nodeId === "node_image"),
    ).toBe(false);
  });

  it("marks async provider failures on the node", async () => {
    const document = executeWorkflowStep(
      createStarterWorkflowDocument({ id: "wf_async_fail", title: "Async" }),
    );

    const finished = await executeWorkflowStepAsync(document, {
      createProviderArtifact: async () => {
        throw new Error("provider unavailable");
      },
    });

    expect(
      finished.nodes.find((node) => node.id === "node_image")?.runtimeState,
    ).toMatchObject({
      status: "failed",
      message: "provider unavailable",
    });
  });

  it("keeps unsafe async workflow nodes approval-gated after abort", async () => {
    const document: WorkflowDocument = {
      id: "wf_unsafe_async",
      title: "Unsafe async",
      version: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      variables: [],
      artifacts: [],
      nodes: [
        createWorkflowNode({
          id: "node_shell",
          type: "shellCommand",
          position: { x: 0, y: 0 },
        }),
      ],
      edges: [],
    };

    const controller = new AbortController();
    const execution = startWorkflowStepExecution(document, {
      signal: controller.signal,
    });
    controller.abort();
    const finished = await execution.finished;

    expect(execution.document.nodes[0]?.runtimeState).toMatchObject({
      status: "waiting-approval",
    });
    expect(finished).toEqual(execution.document);
  });

  it("falls back to placeholder media adapters for unknown providers", () => {
    const promptReady = executeWorkflowStep(
      createStarterWorkflowDocument({ id: "wf_1", title: "Draft" }),
    );
    const withUnknownProvider = updateWorkflowNodeConfig(
      promptReady,
      "node_image",
      { provider: "unknown-lab", model: "dream-v0" },
    );
    const imageNode = withUnknownProvider.nodes.find(
      (node) => node.id === "node_image",
    );

    expect(
      imageNode &&
        createWorkflowProviderArtifact(withUnknownProvider, imageNode),
    ).toMatchObject({
      preview: expect.stringMatching(/^data:image\/svg\+xml;base64,/),
      value: {
        adapterId: "placeholder-media",
        provider: "unknown-lab",
        model: "dream-v0",
      },
    });
  });

  it("collects upstream artifact ids into output nodes", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });
    const finished = executeWorkflowStep(
      executeWorkflowStep(executeWorkflowStep(document)),
    );

    expect(
      finished.nodes.find((node) => node.id === "node_output"),
    ).toMatchObject({
      runtimeState: {
        status: "completed",
        artifactIds: ["wf_1:node_image:image"],
      },
    });
    expect(
      finished.artifacts.find(
        (artifact) => artifact.id === "wf_1:node_image:image",
      ),
    ).toMatchObject({
      nodeId: "node_image",
      type: "image",
      preview: expect.stringMatching(/^data:image\/svg\+xml;base64,/),
    });
  });

  it("executes safe workflow steps until the graph is complete", () => {
    const finished = executeWorkflowUntilBlocked(
      createStarterWorkflowDocument({ id: "wf_1", title: "Draft" }),
    );

    expect(finished.nodes.map((node) => node.runtimeState.status)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
    ]);
    expect(
      finished.nodes.find((node) => node.id === "node_output"),
    ).toMatchObject({
      runtimeState: {
        status: "completed",
        artifactIds: ["wf_1:node_image:image"],
      },
    });
    expect(finished.artifacts.map((artifact) => artifact.id)).toEqual([
      "wf_1:node_prompt:text",
      "wf_1:node_terminal:terminal",
      "wf_1:node_image:image",
    ]);
    expect(getReadyNodeIds(finished)).toEqual([]);
  });

  it("runs until blocked by shell and agent approval gates", () => {
    const document = addWorkflowNode(
      addWorkflowNode(
        createStarterWorkflowDocument({ id: "wf_1", title: "Draft" }),
        {
          id: "node_shell_1",
          type: "shellCommand",
          position: { x: 80, y: 620 },
        },
      ),
      {
        id: "node_agent_1",
        type: "agent",
        position: { x: 420, y: 620 },
      },
    );
    const blocked = executeWorkflowUntilBlocked(document);

    expect(
      blocked.nodes.find((node) => node.id === "node_shell_1"),
    ).toMatchObject({
      runtimeState: {
        status: "waiting-approval",
        message: "Shell commands require explicit approval",
      },
    });
    expect(
      blocked.nodes.find((node) => node.id === "node_agent_1"),
    ).toMatchObject({
      runtimeState: {
        status: "waiting-approval",
        message: "Agent nodes require explicit approval",
      },
    });
    expect(
      blocked.artifacts.some((artifact) => artifact.nodeId === "node_shell_1"),
    ).toBe(false);
    expect(
      blocked.artifacts.some((artifact) => artifact.nodeId === "node_agent_1"),
    ).toBe(false);
  });

  it("executes one safe workflow step with placeholder artifacts", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });
    const next = executeWorkflowStep(document);

    expect(next.nodes.find((node) => node.id === "node_prompt")).toMatchObject({
      runtimeState: {
        status: "completed",
        artifactIds: ["wf_1:node_prompt:text"],
      },
    });
    expect(
      next.nodes.find((node) => node.id === "node_terminal"),
    ).toMatchObject({
      runtimeState: {
        status: "completed",
        artifactIds: ["wf_1:node_terminal:terminal"],
      },
    });
    expect(next.nodes.find((node) => node.id === "node_image")).toMatchObject({
      runtimeState: { status: "idle" },
    });
    expect(
      document.nodes.every((node) => node.runtimeState.status === "idle"),
    ).toBe(true);
  });

  it("waits for approval instead of running shell or agent nodes", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });
    const withDangerousNodes = addWorkflowNode(
      addWorkflowNode(document, {
        id: "node_shell_1",
        type: "shellCommand",
        position: { x: 80, y: 620 },
      }),
      {
        id: "node_agent_1",
        type: "agent",
        position: { x: 420, y: 620 },
      },
    );
    const next = executeWorkflowStep(withDangerousNodes);

    expect(next.nodes.find((node) => node.id === "node_shell_1")).toMatchObject(
      {
        runtimeState: {
          status: "waiting-approval",
          message: "Shell commands require explicit approval",
        },
      },
    );
    expect(next.nodes.find((node) => node.id === "node_agent_1")).toMatchObject(
      {
        runtimeState: {
          status: "waiting-approval",
          message: "Agent nodes require explicit approval",
        },
      },
    );
  });

  it("can run safe-only or selected-only workflow steps", async () => {
    const document = createStarterWorkflowDocument({
      id: "wf_safe",
      title: "Safe only",
    });
    const withUnsafeNodes = addWorkflowNode(
      addWorkflowNode(document, {
        id: "node_shell_1",
        type: "shellCommand",
        position: { x: 80, y: 620 },
      }),
      {
        id: "node_agent_1",
        type: "agent",
        position: { x: 420, y: 620 },
      },
    );

    const safeExecution = startWorkflowStepExecution(withUnsafeNodes, {
      includeUnsafe: false,
    });
    const safeStep = await safeExecution.finished;

    expect(
      safeStep.nodes.find((node) => node.id === "node_prompt"),
    ).toMatchObject({ runtimeState: { status: "completed" } });
    expect(
      safeStep.nodes.find((node) => node.id === "node_shell_1"),
    ).toMatchObject({ runtimeState: { status: "idle" } });
    expect(
      safeStep.nodes.find((node) => node.id === "node_agent_1"),
    ).toMatchObject({ runtimeState: { status: "idle" } });

    const selectedExecution = startWorkflowStepExecution(withUnsafeNodes, {
      includeUnsafe: true,
      nodeIds: ["node_shell_1"],
    });
    const selectedStep = await selectedExecution.finished;

    expect(
      selectedStep.nodes.find((node) => node.id === "node_shell_1"),
    ).toMatchObject({ runtimeState: { status: "waiting-approval" } });
    expect(
      selectedStep.nodes.find((node) => node.id === "node_prompt"),
    ).toMatchObject({ runtimeState: { status: "idle" } });
  });

  it("runs HTTP placeholders and gates unsafe automation nodes", () => {
    const document = addWorkflowNode(
      addWorkflowNode(
        addWorkflowNode(
          createStarterWorkflowDocument({ id: "wf_auto", title: "Automation" }),
          {
            id: "node_http_1",
            type: "httpRequest",
            position: { x: 80, y: 620 },
          },
        ),
        {
          id: "node_file_1",
          type: "fileOperation",
          position: { x: 420, y: 620 },
        },
      ),
      {
        id: "node_browser_1",
        type: "browserAutomation",
        position: { x: 760, y: 620 },
      },
    );
    const next = executeWorkflowStep(document);

    expect(next.nodes.find((node) => node.id === "node_http_1")).toMatchObject({
      runtimeState: {
        status: "completed",
        message: "HTTP request placeholder response ready",
        artifactIds: ["wf_auto:node_http_1:json"],
      },
    });
    expect(
      next.artifacts.find((artifact) => artifact.nodeId === "node_http_1"),
    ).toMatchObject({
      type: "json",
      preview: "HTTP request placeholder response",
    });
    expect(next.nodes.find((node) => node.id === "node_file_1")).toMatchObject({
      runtimeState: {
        status: "waiting-approval",
        message: "File operations require explicit approval",
      },
    });
    expect(
      next.nodes.find((node) => node.id === "node_browser_1"),
    ).toMatchObject({
      runtimeState: {
        status: "waiting-approval",
        message: "Browser automation requires explicit approval",
      },
    });
  });

  it("approves a waiting shell or agent node with placeholder output", () => {
    const document = addWorkflowNode(
      createStarterWorkflowDocument({ id: "wf_1", title: "Draft" }),
      {
        id: "node_shell_1",
        type: "shellCommand",
        position: { x: 80, y: 620 },
      },
    );
    const waiting = executeWorkflowStep(document);
    const approved = approveWorkflowNode(waiting, "node_shell_1");

    expect(
      approved.nodes.find((node) => node.id === "node_shell_1"),
    ).toMatchObject({
      runtimeState: {
        status: "completed",
        message: "Approved placeholder shell output ready",
        artifactIds: ["wf_1:node_shell_1:text"],
      },
    });
  });

  it("rejects a waiting node without running it", () => {
    const document = addWorkflowNode(
      createStarterWorkflowDocument({ id: "wf_1", title: "Draft" }),
      {
        id: "node_agent_1",
        type: "agent",
        position: { x: 80, y: 620 },
      },
    );
    const waiting = executeWorkflowStep(document);
    const rejected = rejectWorkflowNode(waiting, "node_agent_1");

    expect(
      rejected.nodes.find((node) => node.id === "node_agent_1"),
    ).toMatchObject({
      runtimeState: {
        status: "cancelled",
        message: "Approval rejected",
      },
    });
  });

  it("does not approve nodes that are not waiting", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });

    expect(approveWorkflowNode(document, "node_prompt")).toBe(document);
  });

  it("resets workflow runtime state without changing the graph", () => {
    const document = executeWorkflowStep(
      createStarterWorkflowDocument({ id: "wf_1", title: "Draft" }),
    );
    const reset = resetWorkflowRuntime(document);

    expect(reset.nodes.map((node) => node.runtimeState)).toEqual([
      { status: "idle" },
      { status: "idle" },
      { status: "idle" },
      { status: "idle" },
    ]);
    expect(reset.edges).toEqual(document.edges);
    expect(reset.artifacts).toEqual([]);
  });

  it("returns only idle nodes whose dependencies completed", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_1",
      title: "Draft",
    });
    const withState: WorkflowDocument = {
      ...document,
      nodes: document.nodes.map((node) => {
        if (node.id === "node_prompt") {
          return { ...node, runtimeState: { status: "completed" } };
        }
        if (node.id === "node_output") {
          return { ...node, runtimeState: { status: "idle" } };
        }
        return { ...node, runtimeState: { status: "idle" } };
      }),
    };

    expect(getReadyNodeIds(withState)).toEqual(["node_image", "node_terminal"]);
  });
});
