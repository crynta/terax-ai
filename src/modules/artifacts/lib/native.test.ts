import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { artifactsNative } from "@/modules/artifacts/lib/native";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("artifactsNative", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("lists artifacts for one conversation or all durable conversations", async () => {
    vi.mocked(invoke).mockResolvedValue([]);

    await artifactsNative.list("pi-1");
    await artifactsNative.listAll();

    expect(invoke).toHaveBeenNthCalledWith(1, "artifacts_list", {
      conversationId: "pi-1",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "artifacts_list_all");
  });

  it("loads artifact versions and specific version content", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]).mockResolvedValueOnce({
      summary: null,
      content: "",
    });

    await artifactsNative.versions("pi-1", "hero");
    await artifactsNative.get("pi-1", "hero", 2);

    expect(invoke).toHaveBeenNthCalledWith(1, "artifacts_versions", {
      conversationId: "pi-1",
      slug: "hero",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "artifacts_get", {
      conversationId: "pi-1",
      slug: "hero",
      version: 2,
    });
  });

  it("compiles React artifact content through Rust", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      document: "<!doctype html>",
      diagnostics: [],
    });

    await artifactsNative.compileReact(
      "export default function App() { return <div /> }",
      "preview-1",
    );

    expect(invoke).toHaveBeenCalledWith("artifacts_compile_react", {
      input: {
        content: "export default function App() { return <div /> }",
        previewToken: "preview-1",
      },
    });
  });

  it("exports artifact metadata to a selected path without content in args", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      conversationId: "pi-1",
      slug: "hero",
      version: 2,
      path: "/tmp/hero.html",
      contentBytes: 18,
      contentHash: "a".repeat(64),
    });

    await artifactsNative.export("pi-1", "hero", "/tmp/hero.html", 2);

    expect(invoke).toHaveBeenCalledWith("artifacts_export", {
      conversationId: "pi-1",
      slug: "hero",
      destinationPath: "/tmp/hero.html",
      version: 2,
    });
    expect(JSON.stringify(vi.mocked(invoke).mock.calls)).not.toContain(
      "<h1>Hero</h1>",
    );
  });

  it("runs artifact bulk operations through typed Rust commands", async () => {
    vi.mocked(invoke).mockResolvedValue({
      requestedCount: 1,
      successCount: 1,
      failureCount: 0,
      items: [],
    });

    const targets = [{ conversationId: "pi-1", slug: "hero" }];
    await artifactsNative.deleteMany(targets);
    await artifactsNative.restoreDeletedMany([
      { conversationId: "pi-1", slug: "hero", undoToken: "undo-1" },
    ]);
    await artifactsNative.exportMany(targets, "/tmp/artifacts");

    expect(invoke).toHaveBeenNthCalledWith(1, "artifacts_delete_many", {
      targets,
    });
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      "artifacts_restore_deleted_many",
      {
        targets: [
          { conversationId: "pi-1", slug: "hero", undoToken: "undo-1" },
        ],
      },
    );
    expect(invoke).toHaveBeenNthCalledWith(3, "artifacts_export_many", {
      targets,
      destinationDir: "/tmp/artifacts",
    });
  });

  it("lists and purges deleted artifacts through typed Rust commands", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]).mockResolvedValueOnce({
      deleted: true,
      deletedCount: 1,
      undoToken: null,
    });

    await artifactsNative.listDeleted();
    await artifactsNative.purgeDeleted("pi-1", "hero", "undo-1");

    expect(invoke).toHaveBeenNthCalledWith(1, "artifacts_list_deleted");
    expect(invoke).toHaveBeenNthCalledWith(2, "artifacts_purge_deleted", {
      conversationId: "pi-1",
      slug: "hero",
      undoToken: "undo-1",
    });
  });

  it("restores deleted artifacts through a typed Rust command", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ summary: null, content: "" });

    await artifactsNative.restoreDeleted("pi-1", "hero", "undo-1");

    expect(invoke).toHaveBeenCalledWith("artifacts_restore_deleted", {
      conversationId: "pi-1",
      slug: "hero",
      undoToken: "undo-1",
    });
  });

  it("creates, renames, and edits artifacts through typed Rust commands", async () => {
    vi.mocked(invoke).mockResolvedValue({ summary: null, content: "" });

    await artifactsNative.create("pi-1", {
      slug: "hero",
      kind: "html",
      title: "Hero",
      content: "<h1>Hero</h1>",
    });
    await artifactsNative.renameTitle("pi-1", "hero", "Marketing Hero");
    await artifactsNative.edit(
      "pi-1",
      "hero",
      [{ oldText: "Hero", newText: "Title" }],
      2,
    );

    expect(invoke).toHaveBeenNthCalledWith(1, "artifacts_create", {
      conversationId: "pi-1",
      input: {
        slug: "hero",
        kind: "html",
        title: "Hero",
        content: "<h1>Hero</h1>",
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "artifacts_rename_title", {
      conversationId: "pi-1",
      slug: "hero",
      title: "Marketing Hero",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "artifacts_edit", {
      conversationId: "pi-1",
      slug: "hero",
      edits: [{ oldText: "Hero", newText: "Title" }],
      baseVersion: 2,
    });
  });
});
