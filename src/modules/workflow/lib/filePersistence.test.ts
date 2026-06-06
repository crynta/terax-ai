import { describe, expect, it } from "vitest";
import { executeWorkflowStep } from "./execution";
import {
  chooseWorkflowOpenPath,
  chooseWorkflowSavePath,
  isWorkflowFilePath,
  readWorkflowDocumentFile,
  readWorkflowRecentFiles,
  rememberRecentWorkflowFile,
  suggestWorkflowSaveAsPath,
  writeWorkflowDocumentFile,
  writeWorkflowRecentFiles,
} from "./filePersistence";
import {
  createStarterWorkflowDocument,
  serializeWorkflowDocument,
} from "./schema";

describe("workflow file persistence", () => {
  it("recognizes Terax workflow JSON files", () => {
    expect(isWorkflowFilePath("/repo/story.workflow.json")).toBe(true);
    expect(isWorkflowFilePath("C:/repo/STORY.WORKFLOW.JSON")).toBe(true);
    expect(isWorkflowFilePath("/repo/story.json")).toBe(false);
  });

  it("reads workflow documents through an injected file reader", async () => {
    const executed = executeWorkflowStep(
      createStarterWorkflowDocument({ id: "wf_read", title: "Read me" }),
    );

    const result = await readWorkflowDocumentFile("/repo/read.workflow.json", {
      readFile: async (path) => {
        expect(path).toBe("/repo/read.workflow.json");
        return {
          kind: "text",
          content: serializeWorkflowDocument(executed),
          size: 123,
        };
      },
      writeFile: async () => {
        throw new Error("should not write while reading");
      },
    });

    expect(result.title).toBe("Read me");
    expect(result.artifacts).toEqual([]);
    expect(result.nodes.map((node) => node.runtimeState)).toEqual([
      { status: "idle" },
      { status: "idle" },
      { status: "idle" },
      { status: "idle" },
    ]);
  });

  it("rejects non-text workflow files", async () => {
    await expect(
      readWorkflowDocumentFile("/repo/binary.workflow.json", {
        readFile: async () => ({ kind: "binary", size: 42 }),
        writeFile: async () => {},
      }),
    ).rejects.toThrow("not a text file");
  });

  it("suggests safe Save As paths", () => {
    const document = createStarterWorkflowDocument({
      id: "wf_save",
      title: "Mood board: v1",
    });

    expect(suggestWorkflowSaveAsPath(document)).toBe(
      "Mood-board-v1.workflow.json",
    );
    expect(
      suggestWorkflowSaveAsPath(document, {
        currentPath: "/repo/old.workflow.json",
      }),
    ).toBe("/repo/Mood-board-v1.workflow.json");
  });

  it("chooses native Save As paths and enforces workflow extension", async () => {
    const document = createStarterWorkflowDocument({
      id: "wf_save",
      title: "Mood board: v1",
    });
    const requests: unknown[] = [];

    const path = await chooseWorkflowSavePath(document, {
      currentPath: "/repo/old.workflow.json",
      dialog: {
        save: async (request) => {
          requests.push(request);
          return "/repo/mood-board";
        },
        open: async () => null,
      },
    });

    expect(path).toBe("/repo/mood-board.workflow.json");
    expect(requests).toEqual([
      {
        title: "Save workflow as",
        defaultPath: "/repo/Mood-board-v1.workflow.json",
        filters: [{ name: "Terax Workflow", extensions: ["json"] }],
      },
    ]);
  });

  it("chooses native workflow open paths", async () => {
    const path = await chooseWorkflowOpenPath({
      dialog: {
        save: async () => null,
        open: async () => [
          "/repo/first.workflow.json",
          "/repo/second.workflow.json",
        ],
      },
    });

    expect(path).toBe("/repo/first.workflow.json");
  });

  it("dedupes and caps recent workflow files", () => {
    const recent = rememberRecentWorkflowFile(
      [
        { path: "/repo/a.workflow.json", title: "Old A", updatedAt: 1 },
        { path: "/repo/b.workflow.json", title: "B", updatedAt: 2 },
      ],
      { path: "/repo/a.workflow.json", title: "A", updatedAt: 3 },
      { limit: 2 },
    );

    expect(recent).toEqual([
      { path: "/repo/a.workflow.json", title: "A", updatedAt: 3 },
      { path: "/repo/b.workflow.json", title: "B", updatedAt: 2 },
    ]);
  });

  it("round trips recent workflow files through injected storage", () => {
    const storage = new Map<string, string>();
    const store = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    };
    const recent = [
      { path: "/repo/a.workflow.json", title: "A", updatedAt: 3 },
    ];

    writeWorkflowRecentFiles(recent, store);

    expect(readWorkflowRecentFiles(store)).toEqual(recent);
  });

  it("writes runtime-safe workflow documents through an injected file writer", async () => {
    const writes: Array<{ path: string; content: string; source: string }> = [];
    const document = executeWorkflowStep(
      createStarterWorkflowDocument({
        id: "wf_write",
        title: "Write me",
      }),
    );

    await writeWorkflowDocumentFile("/repo/write.workflow.json", document, {
      readFile: async () => ({ kind: "text", content: "", size: 0 }),
      writeFile: async (path, content, source) => {
        writes.push({ path, content, source });
      },
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("/repo/write.workflow.json");
    expect(writes[0]?.source).toBe("workflow");
    const persisted = JSON.parse(writes[0]?.content ?? "{}") as ReturnType<
      typeof createStarterWorkflowDocument
    >;
    expect(persisted).toMatchObject({
      id: "wf_write",
      title: "Write me",
      version: 1,
    });
    expect(persisted.artifacts).toEqual([]);
    expect(persisted.nodes.map((node) => node.runtimeState)).toEqual([
      { status: "idle" },
      { status: "idle" },
      { status: "idle" },
      { status: "idle" },
    ]);
  });
});
