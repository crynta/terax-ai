import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { describe, expect, it, vi } from "vitest";
import { resolveFragment, scrollToFragment } from "./headingAnchors";
import { components, rehypePlugins } from "./RenderedMarkdown";

// The real exported pipeline, so slugs and the sanitizer's user-content-
// clobber cannot drift from what the preview actually emits.
const render = (md: string) =>
  renderToStaticMarkup(
    <Streamdown
      mode="static"
      parseIncompleteMarkdown={false}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {md}
    </Streamdown>,
  );

describe("rehypeHeadingAnchors", () => {
  it("slugifies like GitHub, in the sanitizer's clobbered user-content- form", () => {
    const cases: Array<[md: string, id: string]> = [
      ["## Section", "user-content-section"],
      ["## What's new?", "user-content-whats-new"],
      ["### Foo_bar-baz! (qux)", "user-content-foo_bar-baz-qux"],
      ["## Use `pnpm test` now", "user-content-use-pnpm-test-now"],
      ["## Héllo Wörld", "user-content-héllo-wörld"],
      // GitHub drops the emoji but keeps the following space's hyphen.
      ["## \u{1F680} Launch", "user-content--launch"],
      ["# one", "user-content-one"],
      ["###### six", "user-content-six"],
    ];
    for (const [md, id] of cases) {
      expect(render(md)).toContain(`id="${id}"`);
    }
  });

  // The third "Setup" takes -2; a literal "Setup 1" then collides with the
  // -1 suffix already claimed, so it gets suffixed again: setup-1-1.
  it("suffixes and dedups duplicate slugs", () => {
    const html = render("# Setup\n\n## Setup\n\n### Setup\n\n#### Setup 1");
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual([
      "user-content-setup",
      "user-content-setup-1",
      "user-content-setup-2",
      "user-content-setup-1-1",
    ]);
  });
});

// Node-environment fakes: resolveFragment's selectors are plain [id="..."]
// forms the fake can parse back with JSON.parse.
const paneWith = (ids: string[]) =>
  ({
    querySelector: (sel: string) => {
      const id = JSON.parse(sel.slice("[id=".length, -1)) as string;
      return ids.includes(id) ? ({ id } as unknown as Element) : null;
    },
  }) as unknown as Element;

const linkIn = (pane: Element | null) =>
  ({ closest: () => pane }) as unknown as Element;

describe("resolveFragment", () => {
  it("resolves fragments against the pane's ids", () => {
    const cases: Array<
      [paneIds: string[] | null, fragment: string, expected: string | null]
    > = [
      // Prefers the sanitizer's user-content- form over the bare id.
      [["user-content-setup", "setup"], "setup", "user-content-setup"],
      [["setup"], "setup", "setup"],
      [
        ["user-content-héllo-wörld"],
        "h%C3%A9llo-w%C3%B6rld",
        "user-content-héllo-wörld",
      ],
      // Malformed percent escape must return null, not throw.
      [[], "100%", null],
      // Link outside a preview pane.
      [null, "setup", null],
    ];
    for (const [ids, fragment, expected] of cases) {
      const el = resolveFragment(linkIn(ids && paneWith(ids)), fragment);
      expect(el?.id ?? null).toBe(expected);
    }
  });
});

// Targets expose ONLY getBoundingClientRect: a regression back to
// target.scrollIntoView (which shears overflow-hidden ancestors) throws here.
describe("scrollToFragment", () => {
  const scroller = () => ({
    scrollTop: 40,
    getBoundingClientRect: () => ({ top: 10 }),
    scrollTo: vi.fn(),
  });

  // A block target is its own closest() match; an inline target resolves
  // to its enclosing block's rect instead.
  const blockTarget = (top: number) => {
    const el = {
      getBoundingClientRect: () => ({ top }),
      closest: () => el,
    };
    return el;
  };
  const inlineTarget = (top: number, blockTop: number) => ({
    getBoundingClientRect: () => ({ top }),
    closest: () => ({ getBoundingClientRect: () => ({ top: blockTop }) }),
  });

  const paneOver = (ids: Record<string, unknown>, parent: unknown) =>
    ({
      parentElement: parent,
      querySelector: (sel: string) => {
        const id = JSON.parse(sel.slice("[id=".length, -1)) as string;
        return (ids[id] as Element | undefined) ?? null;
      },
    }) as unknown as Element;

  it("scrolls the pane's own scroll container, not the target", () => {
    const cases = [
      { target: blockTarget(250), scrollTop: 40, top: 250 - 10 + 40 - 8 },
      // Inline target: the enclosing block's rect, not the raised sup rect.
      { target: inlineTarget(244, 230), scrollTop: 40, top: 230 - 10 + 40 - 8 },
      // Targets near the document top clamp at zero.
      { target: blockTarget(12), scrollTop: 0, top: 0 },
    ];
    for (const c of cases) {
      const s = { ...scroller(), scrollTop: c.scrollTop };
      scrollToFragment(linkIn(paneOver({ "user-content-x": c.target }, s)), "x");
      expect(s.scrollTo).toHaveBeenCalledWith({ top: c.top });
    }
  });

  // Under CSS zoom rects are visual px, scrollTop/offsetHeight layout px:
  // scale 625/500 = 1.25, so (250-10)/1.25 + 40 - 8 = 224. offsetHeight 0
  // (detached/unmeasured scroller) would divide by zero; the guard forces
  // scale 1 so the unzoomed math still holds.
  it("divides the visual anchor delta by CSS zoom scale", () => {
    const cases = [
      { offsetHeight: 500, top: 224 },
      { offsetHeight: 0, top: 250 - 10 + 40 - 8 },
    ];
    for (const c of cases) {
      const s = {
        scrollTop: 40,
        offsetHeight: c.offsetHeight,
        getBoundingClientRect: () => ({ top: 10, height: 625 }),
        scrollTo: vi.fn(),
      };
      scrollToFragment(
        linkIn(paneOver({ "user-content-x": blockTarget(250) }, s)),
        "x",
      );
      expect(s.scrollTo).toHaveBeenCalledWith({ top: c.top });
    }
  });

  it("no-ops on unresolved fragments and missing scroll containers", () => {
    const s = scroller();
    scrollToFragment(linkIn(paneOver({}, s)), "missing");
    expect(s.scrollTo).not.toHaveBeenCalled();
    expect(() =>
      scrollToFragment(
        linkIn(paneOver({ "user-content-x": blockTarget(5) }, null)),
        "x",
      ),
    ).not.toThrow();
  });
});
