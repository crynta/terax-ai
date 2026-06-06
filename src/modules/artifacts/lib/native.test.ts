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

  it("lists artifacts for a Pi conversation", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);

    await artifactsNative.list("pi-1");

    expect(invoke).toHaveBeenCalledWith("artifacts_list", {
      conversationId: "pi-1",
    });
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
    );

    expect(invoke).toHaveBeenCalledWith("artifacts_compile_react", {
      input: {
        content: "export default function App() { return <div /> }",
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

  it("creates and edits artifacts through typed Rust commands", async () => {
    vi.mocked(invoke).mockResolvedValue({ summary: null, content: "" });

    await artifactsNative.create("pi-1", {
      slug: "hero",
      kind: "html",
      title: "Hero",
      content: "<h1>Hero</h1>",
    });
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
    expect(invoke).toHaveBeenNthCalledWith(2, "artifacts_edit", {
      conversationId: "pi-1",
      slug: "hero",
      edits: [{ oldText: "Hero", newText: "Title" }],
      baseVersion: 2,
    });
  });
});
