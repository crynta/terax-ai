import { describe, expect, it } from "vitest";
import { checkReadable } from "@/modules/ai/lib/security";
import {
  isAllowedLocalImage,
  isInsideRoot,
  previewBoundary,
  rehypeLocalImages,
  resolveRelativeAsset,
} from "./assetPath";

describe("resolveRelativeAsset", () => {
  const base = "/work/proj/docs/guide.md";

  it("resolves sibling and nested references", () => {
    expect(resolveRelativeAsset(base, "a.png")).toBe("/work/proj/docs/a.png");
    expect(resolveRelativeAsset(base, "./img/a.png")).toBe(
      "/work/proj/docs/img/a.png",
    );
  });

  it("walks up with .. but never above the root", () => {
    expect(resolveRelativeAsset(base, "../assets/a.png")).toBe(
      "/work/proj/assets/a.png",
    );
    expect(resolveRelativeAsset(base, "../../../../../a.png")).toBe("/a.png");
  });

  it("decodes percent escapes and drops query and fragment", () => {
    expect(resolveRelativeAsset(base, "my%20pic.png?raw=1#x")).toBe(
      "/work/proj/docs/my pic.png",
    );
    expect(resolveRelativeAsset(base, "bad%E0%A4%A.png")).toBe(
      "/work/proj/docs/bad%E0%A4%A.png",
    );
  });

  it("leaves non-relative references alone", () => {
    for (const src of [
      "",
      "#top",
      "/abs/a.png",
      "//cdn.example.com/a.png",
      "https://example.com/a.png",
      "data:image/png;base64,AAAA",
      "asset://localhost/x",
      "C:\\img\\a.png",
    ]) {
      expect(resolveRelativeAsset(base, src)).toBeNull();
    }
  });

  it("keeps Windows separators and drive roots", () => {
    expect(
      resolveRelativeAsset("C:\\proj\\docs\\guide.md", "../img/a.png"),
    ).toBe("C:\\proj\\img\\a.png");
  });
});

const policy = (boundary: string) => ({
  boundary,
  isReadable: (abs: string) => checkReadable(abs).ok,
});

describe("isInsideRoot / previewBoundary", () => {
  it("is lexical and separator-agnostic, never matching siblings", () => {
    expect(isInsideRoot("/w/p", "/w/p/a/b.png")).toBe(true);
    expect(isInsideRoot("/w/p/", "/w/p/a.png")).toBe(true);
    expect(isInsideRoot("/w/p", "/w/p")).toBe(false);
    expect(isInsideRoot("/w/p", "/w/prod/a.png")).toBe(false);
    expect(isInsideRoot("C:\\W\\P", "c:/w/p/a.png")).toBe(true);
  });

  it("uses the workspace root when it holds the document, else the document folder", () => {
    expect(previewBoundary("/w/p/docs/a.md", "/w/p")).toBe("/w/p");
    expect(previewBoundary("/other/docs/a.md", "/w/p")).toBe("/other/docs");
    expect(previewBoundary("/w/p/docs/a.md", null)).toBe("/w/p/docs");
  });
});

describe("isAllowedLocalImage", () => {
  const p = policy("/w/p");

  it("allows image types inside the boundary", () => {
    for (const ext of ["png", "JPG", "jpeg", "gif", "webp", "avif", "svg", "bmp", "ico"]) {
      expect(isAllowedLocalImage(`/w/p/img/a.${ext}`, p)).toBe(true);
    }
  });

  it("refuses paths outside the boundary", () => {
    expect(isAllowedLocalImage("/w/other/a.png", p)).toBe(false);
    expect(isAllowedLocalImage("/home/me/a.png", p)).toBe(false);
    expect(isAllowedLocalImage("/w/prod/a.png", p)).toBe(false);
  });

  it("refuses anything that is not an image type", () => {
    for (const name of ["notes.md", "id_rsa", "a.png.txt", "a", ".png", "data.json", "x.html"]) {
      expect(isAllowedLocalImage(`/w/p/${name}`, p)).toBe(false);
    }
  });

  it("refuses secret paths even when they look like images", () => {
    expect(isAllowedLocalImage("/w/p/.ssh/shot.png", p)).toBe(false);
    expect(isAllowedLocalImage("/w/p/.git/logo.png", p)).toBe(false);
    expect(isAllowedLocalImage("/w/p/.env.png", p)).toBe(false);
    expect(isAllowedLocalImage("/w/p/key.pem.png", p)).toBe(false);
  });
});

describe("rehypeLocalImages", () => {
  const img = (src: string) => ({
    type: "element",
    tagName: "img",
    properties: { src } as { src?: string },
    children: [],
  });
  const run = (src: string, doc = "/w/p/docs/readme.md", root = "/w/p") => {
    const node = img(src);
    const t = { type: "root", children: [{ type: "element", tagName: "p", children: [node] }] };
    rehypeLocalImages(doc, (p) => `asset://${p}`, policy(root))()(t);
    return node.properties.src;
  };

  it("rewrites allowed relative images at any depth", () => {
    expect(run("./a.png")).toBe("asset:///w/p/docs/a.png");
    expect(run("../img/a.svg")).toBe("asset:///w/p/img/a.svg");
  });

  it("leaves remote images alone", () => {
    expect(run("https://example.com/b.png")).toBe("https://example.com/b.png");
  });

  it("does not rewrite traversal out of the workspace", () => {
    expect(run("../../../../.ssh/id_rsa.png")).toBe("../../../../.ssh/id_rsa.png");
    expect(run("../../../etc/logo.png")).toBe("../../../etc/logo.png");
  });

  it("does not rewrite non-image files or secret paths", () => {
    expect(run("../notes.md")).toBe("../notes.md");
    expect(run("../.ssh/id_rsa")).toBe("../.ssh/id_rsa");
    expect(run("../.env.png")).toBe("../.env.png");
  });

  it("never rewrites absolute references", () => {
    expect(run("/etc/passwd")).toBe("/etc/passwd");
    expect(run("C:\\Users\\me\\a.png")).toBe("C:\\Users\\me\\a.png");
  });

  it("drops asset-protocol URLs written in the document", () => {
    expect(run("asset://localhost/%2Fetc%2Fpasswd")).toBeUndefined();
    expect(run("https://asset.localhost/C%3A%2Fsecret.png")).toBeUndefined();
    expect(run("//asset.localhost/x.png")).toBeUndefined();
  });

  it("confines a document outside the workspace to its own folder", () => {
    expect(run("./a.png", "/elsewhere/d/r.md", "/elsewhere/d")).toBe("asset:///elsewhere/d/a.png");
    expect(run("../a.png", "/elsewhere/d/r.md", "/elsewhere/d")).toBe("../a.png");
  });
});
