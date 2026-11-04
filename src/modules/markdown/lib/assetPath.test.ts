import { describe, expect, it } from "vitest";
import { rehypeLocalImages, resolveRelativeAsset } from "./assetPath";

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

describe("rehypeLocalImages", () => {
  const tree = () => ({
    type: "root",
    children: [
      {
        type: "element",
        tagName: "p",
        children: [
          {
            type: "element",
            tagName: "img",
            properties: { src: "./a.png" },
            children: [],
          },
          {
            type: "element",
            tagName: "img",
            properties: { src: "https://example.com/b.png" },
            children: [],
          },
        ],
      },
    ],
  });

  it("rewrites only relative images, at any depth", () => {
    const t = tree();
    rehypeLocalImages("/d/readme.md", (p) => `asset://${p}`)()(t);
    const [local, remote] = t.children[0].children;
    expect(local.properties.src).toBe("asset:///d/a.png");
    expect(remote.properties.src).toBe("https://example.com/b.png");
  });
});
