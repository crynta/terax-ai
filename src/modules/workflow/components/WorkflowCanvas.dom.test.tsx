/**
 * @vitest-environment jsdom
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauriCoreMock = vi.hoisted(() => ({
  invoke: vi.fn(),
}));
const openerMock = vi.hoisted(() => ({
  openPath: vi.fn(),
  openUrl: vi.fn(),
  revealItemInDir: vi.fn(),
}));
const dialogMock = vi.hoisted(() => ({
  save: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: tauriCoreMock.invoke,
}));
vi.mock("@tauri-apps/plugin-dialog", () => dialogMock);
vi.mock("@tauri-apps/plugin-opener", () => openerMock);
vi.mock("@/modules/terminal", () => ({
  TerminalPane: () => null,
}));

import type { WorkflowDiscoveredProviderModels } from "../lib/providerConfigUi";
import {
  createStarterWorkflowDocument,
  type WorkflowArtifact,
  type WorkflowDocument,
} from "../lib/schema";
import type { WorkflowRuntimeExecutors } from "./WorkflowCanvas";
import { WorkflowCanvas } from "./WorkflowCanvas";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

type MountedCanvas = {
  container: HTMLElement;
  root: Root;
};

const mounted: MountedCanvas[] = [];
let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  tauriCoreMock.invoke.mockReset();
  openerMock.openPath.mockReset();
  openerMock.openUrl.mockReset();
  openerMock.revealItemInDir.mockReset();
  dialogMock.save.mockReset();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    const message = String(args[0] ?? "");
    if (message.includes("Cannot update a component")) {
      throw new Error(message);
    }
  });
});

function WorkflowCanvasHarness({
  discoveredProviderModels,
  filePath,
  initialDocument,
  runtimeExecutors,
}: {
  discoveredProviderModels?: WorkflowDiscoveredProviderModels;
  filePath?: string;
  initialDocument?: WorkflowDocument;
  runtimeExecutors?: WorkflowRuntimeExecutors;
}) {
  const [document, setDocument] = useState(
    initialDocument ??
      createStarterWorkflowDocument({ id: "wf_dom", title: "DOM workflow" }),
  );
  return (
    <WorkflowCanvas
      document={document}
      visible={true}
      discoveredProviderModels={discoveredProviderModels}
      filePath={filePath}
      onDocumentChange={setDocument}
      runtimeExecutors={runtimeExecutors}
    />
  );
}

async function renderWorkflowCanvas(
  runtimeExecutors?: WorkflowRuntimeExecutors,
  initialDocument?: WorkflowDocument,
  discoveredProviderModels?: WorkflowDiscoveredProviderModels,
  filePath?: string,
): Promise<MountedCanvas> {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    value: ResizeObserverStub,
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: ResizeObserverStub,
  });
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  }
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: vi.fn(() => null),
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <WorkflowCanvasHarness
        discoveredProviderModels={discoveredProviderModels}
        filePath={filePath}
        initialDocument={initialDocument}
        runtimeExecutors={runtimeExecutors}
      />,
    );
  });
  const result = { container, root };
  mounted.push(result);
  return result;
}

afterEach(() => {
  vi.unstubAllGlobals();
  consoleErrorSpy?.mockRestore();
  consoleErrorSpy = null;
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

describe("WorkflowCanvas DOM workflow", () => {
  it("creates, configures, and runs an HTTP node from the UI", async () => {
    const httpExecutor: NonNullable<
      WorkflowRuntimeExecutors["executeHttpRequest"]
    > = vi.fn(async () => ({
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      bodyText: '{"ok":true}',
      bodyJson: { ok: true },
    }));
    const { container } = await renderWorkflowCanvas({
      executeHttpRequest: httpExecutor,
    });

    await clickButton(container, "HTTP");
    await waitFor(() =>
      expect(container.textContent).toContain("HTTP Request"),
    );

    await changeValue(
      getField(container, "https://api.example.com"),
      "https://example.test/status",
    );
    await clickButton(container, "Run safe");

    await waitFor(() => expect(httpExecutor).toHaveBeenCalled());
    expect(httpExecutor).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.test/status" }),
    );
    await waitFor(() => expect(container.textContent).toContain("200 OK"));
  });

  it("renders workflow handles as large connectable drag targets", async () => {
    const { container } = await renderWorkflowCanvas();

    await waitFor(() =>
      expect(
        container.querySelectorAll(".react-flow__handle").length,
      ).toBeGreaterThan(0),
    );
    const promptOutput = container.querySelector<HTMLElement>(
      '[data-testid="workflow-handle-node_prompt-text-source"]',
    );
    const imageInput = container.querySelector<HTMLElement>(
      '[data-testid="workflow-handle-node_image-prompt-target"]',
    );

    expect(promptOutput).not.toBeNull();
    expect(imageInput).not.toBeNull();
    expect(promptOutput?.style.pointerEvents).toBe("auto");
    expect(promptOutput?.style.width).toBe("22px");
    expect(imageInput?.style.pointerEvents).toBe("auto");
    expect(imageInput?.style.width).toBe("22px");
  });

  it("connects compatible handles with click-to-connect fallback", async () => {
    const starter = createStarterWorkflowDocument({
      id: "wf_dom",
      title: "DOM workflow",
    });
    const { container } = await renderWorkflowCanvas(undefined, {
      ...starter,
      edges: [],
    });

    await clickHandle(container, "workflow-handle-node_prompt-text-source");
    await waitFor(() =>
      expect(container.textContent).toContain("Prompt Text selected"),
    );
    await clickHandle(container, "workflow-handle-node_image-prompt-target");

    await waitFor(() =>
      expect(container.textContent).toContain(
        "Connected Prompt to Image Generation",
      ),
    );
    await waitFor(() =>
      expect(
        container.querySelector(".workflow-fallback-edge-path"),
      ).not.toBeNull(),
    );
    const fallbackEdge = container.querySelector<SVGPathElement>(
      ".workflow-fallback-edge-path",
    );
    expect(fallbackEdge?.getAttribute("stroke")).toBe("var(--primary)");
    expect(fallbackEdge?.getAttribute("stroke-width")).toBe("3");
  });

  it("connects compatible handles by mouse drag fallback", async () => {
    const starter = createStarterWorkflowDocument({
      id: "wf_dom",
      title: "DOM workflow",
    });
    const { container } = await renderWorkflowCanvas(undefined, {
      ...starter,
      edges: [],
    });

    const source = await getHandle(
      container,
      "workflow-handle-node_prompt-text-source",
    );
    const target = await getHandle(
      container,
      "workflow-handle-node_image-prompt-target",
    );
    source.getBoundingClientRect = vi.fn(() =>
      rectWithPosition({ left: 100, top: 100, width: 22, height: 22 }),
    );
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => target),
    });

    await act(async () => {
      source.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          clientX: 111,
          clientY: 111,
        }),
      );
    });
    await act(async () => {
      window.dispatchEvent(
        new MouseEvent("mousemove", { clientX: 420, clientY: 120 }),
      );
      window.dispatchEvent(
        new MouseEvent("mouseup", { clientX: 420, clientY: 120 }),
      );
    });

    await waitFor(() =>
      expect(container.textContent).toContain(
        "Connected Prompt to Image Generation",
      ),
    );
    await waitFor(() =>
      expect(
        container.querySelector(".workflow-fallback-edge-path"),
      ).not.toBeNull(),
    );
  });

  it("deletes a workflow node and its incident visual edges", async () => {
    const starter = createStarterWorkflowDocument({
      id: "wf_dom",
      title: "DOM workflow",
    });
    const { container } = await renderWorkflowCanvas(undefined, starter);

    await waitFor(() =>
      expect(
        container.querySelectorAll(".workflow-fallback-edge-path"),
      ).toHaveLength(2),
    );
    await clickByTestId(container, "workflow-delete-node-node_image");
    await clickButton(document.body, "Delete Node");

    await waitFor(() =>
      expect(
        container.querySelector(
          '[data-testid="workflow-handle-node_image-prompt-target"]',
        ),
      ).toBeNull(),
    );
    expect(container.textContent).toContain("Deleted Image Generation");
    expect(
      container.querySelectorAll(".workflow-fallback-edge-path"),
    ).toHaveLength(0);
  });

  it("clears the whole workflow canvas with a toolbar action", async () => {
    const starter = createStarterWorkflowDocument({
      id: "wf_dom",
      title: "DOM workflow",
    });
    const { container } = await renderWorkflowCanvas(undefined, starter);

    await clickByTestId(container, "workflow-clear-canvas");
    expect(document.body.textContent).toContain(
      "Clear all workflow nodes, edges, and artifacts?",
    );
    await clickButton(document.body, "Clear Canvas");
    await waitFor(() =>
      expect(container.querySelectorAll(".react-flow__node")).toHaveLength(0),
    );
    expect(
      container.querySelectorAll(".workflow-fallback-edge-path"),
    ).toHaveLength(0);
    expect(container.textContent).toContain("Canvas cleared");
    expect(container.textContent).toContain("0 safe ready");
  });

  it("surfaces discovered provider models and settings affordance", async () => {
    const starter = createStarterWorkflowDocument({
      id: "wf_dom",
      title: "DOM workflow",
    });
    const openAiDocument: WorkflowDocument = {
      ...starter,
      nodes: starter.nodes.map((node) =>
        node.id === "node_image"
          ? {
              ...node,
              config: {
                ...node.config,
                provider: "openai",
                model: "gpt-image-2",
              },
            }
          : node,
      ),
    };
    const { container } = await renderWorkflowCanvas(
      undefined,
      openAiDocument,
      { openai: ["custom-image-model"] },
    );

    await waitFor(() =>
      expect(container.innerHTML).toContain("custom-image-model"),
    );
    expect(container.textContent).toContain("Open settings");
  });

  it("renders generated placeholder image artifacts as previewable images", async () => {
    const { container } = await renderWorkflowCanvas();

    await clickButton(container, "Run safe");

    await waitFor(() =>
      expect(
        container.querySelector('img[src^="data:image/svg+xml;base64,"]'),
      ).not.toBeNull(),
    );
    const image = container.querySelector<HTMLImageElement>(
      'img[src^="data:image/svg+xml;base64,"]',
    );
    expect(image?.alt).toBe("Image Generation");
    expect(container.textContent).toContain("image/svg+xml");
    expect(container.textContent).not.toContain("application/json");
  });

  it("materializes inline SVG artifact actions to durable workflow files", async () => {
    const svgPreview = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
    const artifact: WorkflowArtifact = {
      id: "wf_dom:node_image:image",
      nodeId: "node_image",
      portId: "image",
      type: "image",
      label: "Generated image",
      preview: svgPreview,
    };
    const clipboard = { writeText: vi.fn(async () => undefined) };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: clipboard,
    });
    tauriCoreMock.invoke.mockResolvedValue(undefined);
    const starter = createStarterWorkflowDocument({
      id: "wf_dom",
      title: "DOM workflow",
    });
    const { container } = await renderWorkflowCanvas(
      undefined,
      {
        ...starter,
        artifacts: [artifact],
      },
      undefined,
      "/repo/workflows/test.workflow.json",
    );
    const expectedPath =
      "/repo/workflows/.terax-workflow-artifacts/wf_dom/wf_dom-node_image-image.svg";

    await clickButton(container, "Copy path");
    await waitFor(() =>
      expect(clipboard.writeText).toHaveBeenCalledWith(expectedPath),
    );
    expect(tauriCoreMock.invoke).toHaveBeenCalledWith(
      "fs_write_base64_file",
      expect.objectContaining({
        contentBase64: "PHN2Zz48L3N2Zz4=",
        path: expectedPath,
        source: "workflow-artifact-binary",
      }),
    );

    await clickButton(container, "Open");
    await waitFor(() =>
      expect(tauriCoreMock.invoke).toHaveBeenCalledWith("fs_open_file", {
        path: expectedPath,
        workspace: { kind: "local" },
      }),
    );

    await clickButton(container, "Reveal");
    await waitFor(() =>
      expect(openerMock.revealItemInDir).toHaveBeenCalledWith(expectedPath),
    );
  });

  it("updates inline SVG artifact metadata after export", async () => {
    const artifact: WorkflowArtifact = {
      id: "wf_dom:node_image:image",
      nodeId: "node_image",
      portId: "image",
      type: "image",
      label: "Generated image",
      preview: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    };
    const clipboard = { writeText: vi.fn(async () => undefined) };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: clipboard,
    });
    dialogMock.save.mockResolvedValue("/tmp/exported.v2");
    tauriCoreMock.invoke.mockResolvedValue(undefined);
    const starter = createStarterWorkflowDocument({
      id: "wf_dom",
      title: "DOM workflow",
    });
    const { container } = await renderWorkflowCanvas(undefined, {
      ...starter,
      artifacts: [artifact],
    });

    await clickButton(container, "Export");
    await waitFor(() =>
      expect(tauriCoreMock.invoke).toHaveBeenCalledWith(
        "fs_write_base64_file",
        expect.objectContaining({
          contentBase64: "PHN2Zz48L3N2Zz4=",
          path: "/tmp/exported.v2.svg",
          source: "workflow-artifact-export",
        }),
      ),
    );

    await clickButton(container, "Copy path");
    await waitFor(() =>
      expect(clipboard.writeText).toHaveBeenCalledWith("/tmp/exported.v2.svg"),
    );
    await clickButton(container, "Reveal");
    await waitFor(() =>
      expect(openerMock.revealItemInDir).toHaveBeenCalledWith(
        "/tmp/exported.v2.svg",
      ),
    );
  });

  it("routes saved SVG artifact actions through durable paths and native export", async () => {
    const svgPreview = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
    const artifact: WorkflowArtifact = {
      id: "wf_dom:node_image:image",
      nodeId: "node_image",
      portId: "image",
      type: "image",
      label: "Generated image",
      preview: svgPreview,
      storage: {
        kind: "file",
        path: "/repo/.terax-workflow-artifacts/wf_dom/image.svg",
        mediaType: "image/svg+xml",
        byteLength: 11,
      },
    };
    const clipboard = { writeText: vi.fn(async () => undefined) };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: clipboard,
    });
    dialogMock.save.mockResolvedValue("/tmp/exported.svg");
    tauriCoreMock.invoke.mockResolvedValue(undefined);
    const starter = createStarterWorkflowDocument({
      id: "wf_dom",
      title: "DOM workflow",
    });
    const { container } = await renderWorkflowCanvas(undefined, {
      ...starter,
      artifacts: [artifact],
    });

    await clickButton(container, "Copy path");
    expect(clipboard.writeText).toHaveBeenCalledWith(
      "/repo/.terax-workflow-artifacts/wf_dom/image.svg",
    );

    await clickButton(container, "Open");
    await waitFor(() =>
      expect(tauriCoreMock.invoke).toHaveBeenCalledWith("fs_open_file", {
        path: "/repo/.terax-workflow-artifacts/wf_dom/image.svg",
        workspace: { kind: "local" },
      }),
    );

    await clickButton(container, "Export");
    await waitFor(() =>
      expect(tauriCoreMock.invoke).toHaveBeenCalledWith(
        "fs_write_base64_file",
        expect.objectContaining({
          contentBase64: "PHN2Zz48L3N2Zz4=",
          path: "/tmp/exported.svg",
          source: "workflow-artifact-export",
        }),
      ),
    );
  });

  it("previews and deletes artifacts from the gallery", async () => {
    const artifact: WorkflowArtifact = {
      id: "wf_dom:node_image:image",
      nodeId: "node_image",
      portId: "image",
      type: "image",
      label: "Generated image",
      preview: "data:image/png;base64,ZmFrZQ==",
      storage: {
        kind: "file",
        path: "/repo/.terax-workflow-artifacts/wf_dom/image.png",
        mediaType: "image/png",
        byteLength: 1024,
      },
    };
    const starter = createStarterWorkflowDocument({
      id: "wf_dom",
      title: "DOM workflow",
    });
    const initialDocument: WorkflowDocument = {
      ...starter,
      artifacts: [artifact],
      nodes: starter.nodes.map((node) =>
        node.id === "node_image"
          ? {
              ...node,
              runtimeState: {
                status: "completed" as const,
                artifactIds: [artifact.id],
              },
            }
          : node,
      ),
    };
    const { container } = await renderWorkflowCanvas(
      undefined,
      initialDocument,
    );

    await clickButton(container, "Preview");
    await waitFor(() =>
      expect(document.body.textContent).toContain("Artifact preview"),
    );
    expect(document.body.textContent).toContain("Generated image");
    await clickButton(document.body, "Close preview");
    await clickButton(container, "Delete");
    await clickButton(document.body, "Delete Artifact");

    await waitFor(() => expect(container.textContent).toContain("0 artifacts"));
  });

  it("keeps Run safe from starting unsafe workflow nodes", async () => {
    const shellExecutor = vi.fn();
    const { container } = await renderWorkflowCanvas({
      executeShellCommand: shellExecutor,
    });

    await clickButton(container, "Command");
    await waitFor(() =>
      expect(container.textContent).toContain("Shell Command"),
    );
    await changeValue(
      getField(container, "Command, requires approval"),
      "echo should-not-run",
    );
    await clickButton(container, "Run safe");

    await waitFor(() =>
      expect(container.textContent).toContain(
        "Run safe stopped at nodes that need approval",
      ),
    );
    expect(shellExecutor).not.toHaveBeenCalled();
    expect(findButton(container, "Approve")).toBeNull();
  });

  it("approves and cancels an unsafe shell run from the UI", async () => {
    const shellExecutor = vi.fn(
      (
        input: Parameters<
          NonNullable<WorkflowRuntimeExecutors["executeShellCommand"]>
        >[0],
      ) =>
        new Promise<
          Awaited<
            ReturnType<
              NonNullable<WorkflowRuntimeExecutors["executeShellCommand"]>
            >
          >
        >((_resolve, reject) => {
          input.reportOutput("started");
          input.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const { container } = await renderWorkflowCanvas({
      executeShellCommand: shellExecutor,
    });

    await clickButton(container, "Command");
    await waitFor(() =>
      expect(container.textContent).toContain("Shell Command"),
    );
    await changeValue(
      getField(container, "Command, requires approval"),
      "sleep 30",
    );
    await clickButton(container, "Run selected");

    await waitFor(() => expect(container.textContent).toContain("Approve"));
    await clickButton(container, "Approve");
    await waitFor(() => expect(shellExecutor).toHaveBeenCalled());
    await clickButton(container, "Cancel");

    await waitFor(() => expect(container.textContent).toContain("cancelled"));
  });
});

async function getHandle(
  container: HTMLElement,
  testId: string,
): Promise<HTMLElement> {
  await waitFor(() =>
    expect(container.querySelector(`[data-testid="${testId}"]`)).not.toBeNull(),
  );
  const handle = container.querySelector<HTMLElement>(
    `[data-testid="${testId}"]`,
  );
  if (!handle) throw new Error(`Missing handle: ${testId}`);
  return handle;
}

async function clickHandle(
  container: HTMLElement,
  testId: string,
): Promise<void> {
  const handle = await getHandle(container, testId);
  await act(async () => {
    handle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function rectWithPosition(input: {
  left: number;
  top: number;
  width: number;
  height: number;
}): DOMRect {
  return {
    bottom: input.top + input.height,
    height: input.height,
    left: input.left,
    right: input.left + input.width,
    top: input.top,
    width: input.width,
    x: input.left,
    y: input.top,
    toJSON: () => ({}),
  };
}

async function clickByTestId(
  container: HTMLElement,
  testId: string,
): Promise<void> {
  const element = container.querySelector<HTMLElement>(
    `[data-testid="${testId}"]`,
  );
  if (!element) throw new Error(`Missing element: ${testId}`);
  await act(async () => {
    element.click();
  });
}

function findButton(
  container: HTMLElement,
  label: string,
): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    ) ?? null
  );
}

async function clickButton(
  container: HTMLElement,
  label: string,
): Promise<void> {
  const button = findButton(container, label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function getField(
  container: HTMLElement,
  placeholder: string,
): HTMLInputElement | HTMLTextAreaElement {
  const field = [...container.querySelectorAll("input, textarea")].find(
    (candidate) => candidate.getAttribute("placeholder") === placeholder,
  );
  if (!field) throw new Error(`Missing field: ${placeholder}`);
  return field as HTMLInputElement | HTMLTextAreaElement;
}

async function changeValue(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Promise<void> {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function waitFor(assertion: () => void, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }
  throw lastError;
}
