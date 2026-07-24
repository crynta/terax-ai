import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { beforeEach, describe, expect, it, vi } from "vitest";

// convertFileSrc mirrors Tauri's internals: the whole path is
// percent-encoded and served from http://asset.localhost/ on Windows
// (asset://localhost/ elsewhere; one test switches the implementation to
// lock the asset scheme through the sanitizer).
const tauri = vi.hoisted(() => ({
  convertFileSrc: vi.fn<(path: string, protocol?: string) => string>(),
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  convertFileSrc: tauri.convertFileSrc,
}));

import { joinPath, parentDir, rehypeLocalImages } from "./localImages";
import { buildRehypePlugins, components } from "./RenderedMarkdown";

const windowsForm = (path: string, protocol = "asset") =>
  `http://${protocol}.localhost/${encodeURIComponent(path)}`;

beforeEach(() => {
  tauri.convertFileSrc.mockReset();
  tauri.convertFileSrc.mockImplementation(windowsForm);
});

// The real pipeline exported by RenderedMarkdown, so plugin order and the
// sanitizer schema cannot drift from what the preview actually runs.
const render = (md: string, baseDir?: string) =>
  renderToStaticMarkup(
    <Streamdown
      mode="static"
      parseIncompleteMarkdown={false}
      rehypePlugins={buildRehypePlugins(baseDir)}
      components={components}
    >
      {md}
    </Streamdown>,
  );

describe("rehypeLocalImages through the full pipeline", () => {
  it("resolves a bare relative src against the document directory", () => {
    const html = render("![shot](img.png)", "D:\\notes");
    expect(html).toContain(`src="${windowsForm("D:/notes/img.png")}"`);
  });

  it("resolves ./ nested paths", () => {
    const html = render("![a](./a/b.png)", "D:\\notes");
    expect(html).toContain(`src="${windowsForm("D:/notes/a/b.png")}"`);
  });

  it("resolves ../ traversal into the parent directory", () => {
    const html = render("![x](../x.png)", "D:\\ws\\docs");
    expect(html).toContain(`src="${windowsForm("D:/ws/x.png")}"`);
  });

  // Documented behavior: escaping above the workspace stays allowed, same
  // as the editor previewing arbitrary paths (assetProtocol scope ["**"]).
  it("resolves traversal above the workspace to the escaped path", () => {
    const html = render("![x](../../other/x.png)", "D:\\ws\\docs");
    expect(html).toContain(`src="${windowsForm("D:/other/x.png")}"`);
  });

  it("clamps backslash traversal past the drive root at the root", () => {
    const html = render(
      '<img src="..\\..\\..\\img.png" alt="up">',
      "D:\\notes",
    );
    expect(html).toContain(`src="${windowsForm("D:/img.png")}"`);
  });

  it("passes http(s) srcs through byte-identical, no conversion", () => {
    const html = render("![r](https://example.com/a.png)", "D:\\notes");
    expect(html).toContain('src="https://example.com/a.png"');
    expect(tauri.convertFileSrc).not.toHaveBeenCalled();
  });

  it("leaves root-absolute srcs unresolved (GitHub repo-root semantics)", () => {
    const html = render("![a](/assets/x.png)", "D:\\notes");
    expect(tauri.convertFileSrc).not.toHaveBeenCalled();
    expect(html).not.toContain("asset.localhost");
  });

  it("no base directory: plugin no-ops, harden degrades to alt text", () => {
    const html = render("![shot](img.png)");
    expect(tauri.convertFileSrc).not.toHaveBeenCalled();
    expect(html).not.toContain("<img");
    expect(html).toContain("shot");
  });

  it("percent-encoded spaces survive the round trip without double encoding", () => {
    const html = render("![shot](my%20shot.png)", "D:\\n");
    expect(html).toContain(`src="${windowsForm("D:/n/my shot.png")}"`);
    expect(html).not.toContain("%2520");
  });

  it("literal spaces in raw HTML srcs survive the round trip", () => {
    const html = render('<img src="my shot.png" alt="s">', "D:\\n");
    expect(html).toContain(`src="${windowsForm("D:/n/my shot.png")}"`);
  });

  it("# in a file name survives via its percent-encoded form", () => {
    const html = render("![v](notes%23v2.png)", "D:\\n");
    expect(html).toContain(`src="${windowsForm("D:/n/notes#v2.png")}"`);
    expect(windowsForm("D:/n/notes#v2.png")).toContain("%23");
  });

  it("the asset scheme (macOS/Linux form) survives the sanitizer", () => {
    tauri.convertFileSrc.mockImplementation(
      (path) => `asset://localhost/${encodeURIComponent(path)}`,
    );
    const html = render("![a](img.png)", "/home/u/notes");
    expect(html).toContain(
      `src="asset://localhost/${encodeURIComponent("/home/u/notes/img.png")}"`,
    );
  });

  it("no other scheme sneaks into img src through the sanitizer", () => {
    const html = render('<img src="foo://x/y.png" alt="f">', "D:\\notes");
    expect(html).not.toContain("foo://");
    expect(html).not.toContain("<img");
  });
});

describe("rehypeLocalImages transformer", () => {
  it("leaves data: srcs byte-identical", () => {
    const src = "data:image/png;base64,AAAA";
    const img = {
      type: "element",
      tagName: "img",
      properties: { src },
      children: [],
    };
    rehypeLocalImages("D:/notes")({ type: "root", children: [img] });
    expect(img.properties.src).toBe(src);
    expect(tauri.convertFileSrc).not.toHaveBeenCalled();
  });
});

describe("joinPath", () => {
  it("joins and normalizes across separator styles", () => {
    expect(joinPath("D:\\a\\b", "img.png")).toBe("D:/a/b/img.png");
    expect(joinPath("D:/a/b", "./c/img.png")).toBe("D:/a/b/c/img.png");
    expect(joinPath("D:/a/b", "../img.png")).toBe("D:/a/img.png");
  });

  it("clamps .. at the drive root and at /", () => {
    expect(joinPath("D:/a", "../../../x.png")).toBe("D:/x.png");
    expect(joinPath("/home/u", "../../../x.png")).toBe("/x.png");
  });

  it("preserves the UNC lead-in", () => {
    expect(joinPath("\\\\server\\share\\docs", "../x.png")).toBe(
      "//server/share/x.png",
    );
  });
});

describe("parentDir", () => {
  it("handles both separators, root files and bare names", () => {
    expect(parentDir("D:\\a\\b.md")).toBe("D:\\a");
    expect(parentDir("D:/a/b.md")).toBe("D:/a");
    expect(parentDir("/readme.md")).toBe("/");
    expect(parentDir("readme.md")).toBe("");
  });
});
