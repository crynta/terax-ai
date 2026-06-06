import { describe, expect, it, vi } from "vitest";
import { createWorkflowNativeFileOperationExecutor } from "./nativeFileExecution";
import { createStarterWorkflowDocument, createWorkflowNode } from "./schema";

describe("native workflow file automation executor", () => {
  it("reads text files through the injected native API", async () => {
    const readFile = vi.fn(async () => ({
      kind: "text" as const,
      content: "hello",
      size: 5,
    }));
    const executor = createWorkflowNativeFileOperationExecutor({
      readFile,
      writeFile: vi.fn(),
      deletePath: vi.fn(),
    });

    await expect(
      executor({
        document: createStarterWorkflowDocument({
          id: "wf",
          title: "Workflow",
        }),
        node: createWorkflowNode({
          id: "node_file",
          type: "fileOperation",
          position: { x: 0, y: 0 },
        }),
        operation: "read",
        path: "README.md",
        reportProgress: vi.fn(),
      }),
    ).resolves.toEqual({
      operation: "read",
      path: "README.md",
      content: "hello",
      size: 5,
      kind: "text",
    });
    expect(readFile).toHaveBeenCalledWith("README.md", {
      approved: true,
      documentId: "wf",
      nodeId: "node_file",
    });
  });

  it("writes, appends, and deletes with progress-safe native calls", async () => {
    const writeFile = vi.fn(async () => undefined);
    const deletePath = vi.fn(async () => undefined);
    const executor = createWorkflowNativeFileOperationExecutor({
      readFile: vi.fn(async () => ({
        kind: "text" as const,
        content: "old",
        size: 3,
      })),
      writeFile,
      deletePath,
    });
    const baseInput = {
      document: createStarterWorkflowDocument({ id: "wf", title: "Workflow" }),
      node: createWorkflowNode({
        id: "node_file",
        type: "fileOperation",
        position: { x: 0, y: 0 },
      }),
      path: "notes/out.md",
      reportProgress: vi.fn(),
    };

    await expect(
      executor({ ...baseInput, operation: "write", content: "new" }),
    ).resolves.toMatchObject({ operation: "write", content: "new", size: 3 });
    await expect(
      executor({ ...baseInput, operation: "append", content: "er" }),
    ).resolves.toMatchObject({
      operation: "append",
      content: "older",
      size: 5,
    });
    await expect(
      executor({ ...baseInput, operation: "delete" }),
    ).resolves.toMatchObject({ operation: "delete", path: "notes/out.md" });

    expect(writeFile).toHaveBeenNthCalledWith(
      1,
      "notes/out.md",
      "new",
      "workflow-file-operation",
      { approved: true, documentId: "wf", nodeId: "node_file" },
    );
    expect(writeFile).toHaveBeenNthCalledWith(
      2,
      "notes/out.md",
      "older",
      "workflow-file-operation",
      { approved: true, documentId: "wf", nodeId: "node_file" },
    );
    expect(deletePath).toHaveBeenCalledWith("notes/out.md", {
      approved: true,
      documentId: "wf",
      nodeId: "node_file",
    });
  });
});
