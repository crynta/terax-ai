import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { describe, expect, it, vi } from "vitest";
import { resolveFragment, scrollToFragment } from "./headingAnchors";
import {
  components,
  RenderedMarkdown,
  rehypePlugins,
} from "./RenderedMarkdown";

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
  it("emits ids in the sanitizer's clobbered user-content- form", () => {
    expect(render("## Section")).toContain('id="user-content-section"');
  });

  it("strips punctuation like GitHub: What's new? -> whats-new", () => {
    expect(render("## What's new?")).toContain('id="user-content-whats-new"');
  });

  it("keeps hyphens and underscores, drops other punctuation", () => {
    expect(render("### Foo_bar-baz! (qux)")).toContain(
      'id="user-content-foo_bar-baz-qux"',
    );
  });

  it("suffixes duplicate slugs -1, -2 per document", () => {
    const html = render("# Setup\n\n## Setup\n\n### Setup");
    expect(html).toContain('id="user-content-setup"');
    expect(html).toContain('id="user-content-setup-1"');
    expect(html).toContain('id="user-content-setup-2"');
  });

  // A literal "Setup 1" heading collides with the -1 suffix the second
  // "Setup" already claimed, so it gets suffixed again: setup-1-1.
  it("resolves suffix collisions: Setup, Setup, 'Setup 1'", () => {
    const html = render("# Setup\n\n## Setup\n\n### Setup 1");
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual([
      "user-content-setup",
      "user-content-setup-1",
      "user-content-setup-1-1",
    ]);
  });

  it("includes code span text in the slug", () => {
    expect(render("## Use `pnpm test` now")).toContain(
      'id="user-content-use-pnpm-test-now"',
    );
  });

  // GitHub drops the emoji but keeps the following space's hyphen.
  it("keeps unicode letters and drops leading emoji like GitHub", () => {
    expect(render("## Héllo Wörld")).toContain('id="user-content-héllo-wörld"');
    expect(render("## \u{1F680} Launch")).toContain('id="user-content--launch"');
  });

  it("covers h1 through h6", () => {
    const html = render(
      "# one\n\n## two\n\n### three\n\n#### four\n\n##### five\n\n###### six",
    );
    for (const s of ["one", "two", "three", "four", "five", "six"]) {
      expect(html).toContain(`id="user-content-${s}"`);
    }
  });

  it("fragment links survive the pipeline as anchors with the raw slug", () => {
    const html = render("[jump](#whats-new)\n\n## What's new?");
    expect(html).toContain('href="#whats-new"');
    expect(html).toContain('id="user-content-whats-new"');
  });

  it("frontmatter table headers never get ids", () => {
    const html = renderToStaticMarkup(
      <RenderedMarkdown content={"---\nname: demo\n---\n## name\n"} />,
    );
    expect(html).toContain("<th>name</th>");
    expect(html).not.toMatch(/<th[^>]+id=/);
    expect(html).toContain('id="user-content-name"');
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
  it("prefers the sanitizer's user-content- form over the bare id", () => {
    const el = resolveFragment(
      linkIn(paneWith(["user-content-setup", "setup"])),
      "setup",
    );
    expect(el?.id).toBe("user-content-setup");
  });

  it("falls back to the bare fragment id", () => {
    const el = resolveFragment(linkIn(paneWith(["setup"])), "setup");
    expect(el?.id).toBe("setup");
  });

  it("decodes percent-encoded fragments", () => {
    const el = resolveFragment(
      linkIn(paneWith(["user-content-héllo-wörld"])),
      "h%C3%A9llo-w%C3%B6rld",
    );
    expect(el?.id).toBe("user-content-héllo-wörld");
  });

  it("survives malformed percent escapes without throwing", () => {
    expect(resolveFragment(linkIn(paneWith([])), "100%")).toBeNull();
  });

  it("returns null when the link sits outside a preview pane", () => {
    expect(resolveFragment(linkIn(null), "setup")).toBeNull();
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
    const s = scroller();
    scrollToFragment(
      linkIn(paneOver({ "user-content-live-refresh": blockTarget(250) }, s)),
      "live-refresh",
    );
    expect(s.scrollTo).toHaveBeenCalledWith({ top: 250 - 10 + 40 - 8 });
  });

  it("scrolls an inline target's enclosing block, not the raised sup rect", () => {
    const s = scroller();
    scrollToFragment(
      linkIn(paneOver({ "user-content-fnref-1": inlineTarget(244, 230) }, s)),
      "fnref-1",
    );
    expect(s.scrollTo).toHaveBeenCalledWith({ top: 230 - 10 + 40 - 8 });
  });

  it("clamps at zero for targets near the document top", () => {
    const s = { ...scroller(), scrollTop: 0 };
    scrollToFragment(
      linkIn(paneOver({ "user-content-intro": blockTarget(12) }, s)),
      "intro",
    );
    expect(s.scrollTo).toHaveBeenCalledWith({ top: 0 });
  });

  // Under CSS zoom rects are visual px, scrollTop/offsetHeight layout px:
  // scale 625/500 = 1.25, so (250-10)/1.25 + 40 - 8 = 224.
  it("divides the visual anchor delta by CSS zoom scale", () => {
    const s = {
      scrollTop: 40,
      offsetHeight: 500,
      getBoundingClientRect: () => ({ top: 10, height: 625 }),
      scrollTo: vi.fn(),
    };
    scrollToFragment(
      linkIn(paneOver({ "user-content-live-refresh": blockTarget(250) }, s)),
      "live-refresh",
    );
    expect(s.scrollTo).toHaveBeenCalledWith({ top: 224 });
  });

  // offsetHeight 0 (detached/unmeasured scroller) would divide by zero; the
  // guard forces scale 1 so the unzoomed math still holds.
  it("falls back to scale 1 when the scroller has no layout height", () => {
    const s = {
      scrollTop: 40,
      offsetHeight: 0,
      getBoundingClientRect: () => ({ top: 10, height: 625 }),
      scrollTo: vi.fn(),
    };
    scrollToFragment(
      linkIn(paneOver({ "user-content-x": blockTarget(250) }, s)),
      "x",
    );
    expect(s.scrollTo).toHaveBeenCalledWith({ top: 250 - 10 + 40 - 8 });
  });

  it("does nothing when the fragment does not resolve", () => {
    const s = scroller();
    scrollToFragment(linkIn(paneOver({}, s)), "missing");
    expect(s.scrollTo).not.toHaveBeenCalled();
  });

  it("does nothing when the pane has no scroll container", () => {
    scrollToFragment(
      linkIn(paneOver({ "user-content-x": blockTarget(5) }, null)),
      "x",
    );
  });
});
