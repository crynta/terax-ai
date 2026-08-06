import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The fake mirrors Tauri's convertFileSrc: percent-encoded path served from
// http://asset.localhost/ on Windows, asset://localhost/ elsewhere.
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
  it("resolves relative srcs against the document directory", () => {
    const cases: Array<[md: string, baseDir: string, resolved: string]> = [
      ["![shot](img.png)", "D:\\notes", "D:/notes/img.png"],
      ["![a](./a/b.png)", "D:\\notes", "D:/notes/a/b.png"],
      ["![x](../x.png)", "D:\\ws\\docs", "D:/ws/x.png"],
      // Backslash traversal past the drive root clamps at the root.
      ['<img src="..\\..\\..\\img.png" alt="up">', "D:\\notes", "D:/img.png"],
    ];
    for (const [md, baseDir, resolved] of cases) {
      expect(render(md, baseDir)).toContain(`src="${windowsForm(resolved)}"`);
    }
  });

  // Documented behavior: escaping above the workspace stays allowed, same
  // as the editor previewing arbitrary paths (assetProtocol scope ["**"]).
  it("resolves traversal above the workspace to the escaped path", () => {
    const html = render("![x](../../other/x.png)", "D:\\ws\\docs");
    expect(html).toContain(`src="${windowsForm("D:/other/x.png")}"`);
  });

  it("no base directory: plugin no-ops, harden degrades to alt text", () => {
    const html = render("![shot](img.png)");
    expect(tauri.convertFileSrc).not.toHaveBeenCalled();
    expect(html).not.toContain("<img");
    expect(html).toContain("shot");
  });

  it("decodes exactly once through the round trip", () => {
    const cases: Array<[md: string, resolved: string]> = [
      ["![shot](my%20shot.png)", "D:/n/my shot.png"],
      ['<img src="my shot.png" alt="s">', "D:/n/my shot.png"],
      ["![v](notes%23v2.png)", "D:/n/notes#v2.png"],
    ];
    for (const [md, resolved] of cases) {
      const html = render(md, "D:\\n");
      expect(html).toContain(`src="${windowsForm(resolved)}"`);
      // Double encoding would surface as %2520 in the served URL.
      expect(html).not.toContain("%2520");
    }
    expect(windowsForm("D:/n/notes#v2.png")).toContain("%23");
  });

  it("never rewrites non-relative srcs", () => {
    const cases: Array<[md: string, survivingSrc: string | null]> = [
      ["![r](https://example.com/a.png)", 'src="https://example.com/a.png"'],
      // Root-absolute means repo root on GitHub; here it stays unresolved.
      ["![a](/x.png)", null],
      ["![d](data:image/png;base64,AAAA)", null],
    ];
    for (const [md, survivingSrc] of cases) {
      const html = render(md, "D:\\notes");
      if (survivingSrc) expect(html).toContain(survivingSrc);
      expect(html).not.toContain("asset.localhost");
    }
    // data: byte-identity holds at the transformer; downstream the pipeline's
    // sanitizer strips data: imgs entirely, so it is only observable here.
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

  it("the asset scheme (macOS/Linux form) survives the sanitizer", () => {
    tauri.convertFileSrc.mockImplementation(
      (path) => `asset://localhost/${encodeURIComponent(path)}`,
    );
    const html = render("![a](img.png)", "/home/u/notes");
    expect(html).toContain(
      `src="asset://localhost/${encodeURIComponent("/home/u/notes/img.png")}"`,
    );
  });

  // A drive-letter src parses as a URL with a "c:" scheme; the resolver
  // leaves both alone and the sanitizer strips them.
  it("no other scheme sneaks into img src through the sanitizer", () => {
    const foo = render('<img src="foo://x/y.png" alt="f">', "D:\\notes");
    expect(foo).not.toContain("foo://");
    expect(foo).not.toContain("<img");
    const drive = render("![shot](C:/x.png)", "D:\\notes");
    expect(tauri.convertFileSrc).not.toHaveBeenCalled();
    expect(drive).not.toContain("C:/x.png");
    expect(drive).not.toContain("<img");
    expect(drive).toContain("shot");
  });
});

// The traversal-stays-allowed policy leans on the shipped assetProtocol
// scope of ["**"]; if that scope is ever tightened, this must fail so the
// joinPath traversal policy gets revisited alongside it.
describe("tauri.conf.json assetProtocol contract", () => {
  it("asset protocol is enabled with the wildcard scope", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const conf = JSON.parse(
      readFileSync(
        path.join(here, "../../../src-tauri/tauri.conf.json"),
        "utf8",
      ),
    ) as {
      app: {
        security: { assetProtocol?: { enable?: boolean; scope?: string[] } };
      };
    };
    const assetProtocol = conf.app.security.assetProtocol;
    expect(assetProtocol?.enable).toBe(true);
    expect(assetProtocol?.scope).toContain("**");
  });
});

describe("joinPath", () => {
  it("joins, normalizes and clamps across separator styles", () => {
    const cases: Array<[base: string, rel: string, joined: string]> = [
      ["D:\\a\\b", "img.png", "D:/a/b/img.png"],
      ["D:/a/b", "./c/img.png", "D:/a/b/c/img.png"],
      ["D:/a/b", "../img.png", "D:/a/img.png"],
      // .. clamps at the drive root and at /.
      ["D:/a", "../../../x.png", "D:/x.png"],
      ["/home/u", "../../../x.png", "/x.png"],
      // The UNC //server/share lead-in must survive traversal.
      ["\\\\server\\share\\docs", "../x.png", "//server/share/x.png"],
    ];
    for (const [base, rel, joined] of cases) {
      expect(joinPath(base, rel)).toBe(joined);
    }
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
