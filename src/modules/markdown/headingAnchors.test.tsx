import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { describe, expect, it, vi } from "vitest";
import { resolveFragment, scrollToFragment } from "./headingAnchors";
import {
  components,
  RenderedMarkdown,
  rehypePlugins,
} from "./RenderedMarkdown";

// Uses the real pipeline exported by RenderedMarkdown, so the slugs and the
// sanitizer's user-content- clobber cannot drift from what the preview
// actually emits.
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

  // Unicode letters survive via \p{L}; GitHub drops the emoji but keeps
  // the following space's hyphen (#-launch). Decomposed combining marks
  // and ZWJ sequences are the documented slugger ceiling.
  it("keeps unicode letters and drops leading emoji like GitHub", () => {
    expect(render("## Héllo Wörld")).toContain('id="user-content-héllo-wörld"');
    expect(render("## 🚀 Launch")).toContain('id="user-content--launch"');
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

// Node-environment fakes: resolveFragment only needs closest/querySelector,
// and its selector strings are plain [id="..."] attribute selectors the
// fake can parse back with JSON.parse.
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
// target.scrollIntoView (which shears every scrollable ancestor, including
// the overflow-hidden pane wrapper the user cannot scroll back) throws here.
describe("scrollToFragment", () => {
  const scroller = () => ({
    scrollTop: 40,
    getBoundingClientRect: () => ({ top: 10 }),
    scrollTo: vi.fn(),
  });

  const paneOver = (ids: Record<string, number>, parent: unknown) =>
    ({
      parentElement: parent,
      querySelector: (sel: string) => {
        const id = JSON.parse(sel.slice("[id=".length, -1)) as string;
        return id in ids
          ? { getBoundingClientRect: () => ({ top: ids[id] }) }
          : null;
      },
    }) as unknown as Element;

  it("scrolls the pane's own scroll container, not the target", () => {
    const s = scroller();
    scrollToFragment(
      linkIn(paneOver({ "user-content-live-refresh": 250 }, s)),
      "live-refresh",
    );
    expect(s.scrollTo).toHaveBeenCalledWith({ top: 250 - 10 + 40 });
  });

  it("does nothing when the fragment does not resolve", () => {
    const s = scroller();
    scrollToFragment(linkIn(paneOver({}, s)), "missing");
    expect(s.scrollTo).not.toHaveBeenCalled();
  });

  it("does nothing when the pane has no scroll container", () => {
    scrollToFragment(linkIn(paneOver({ "user-content-x": 5 }, null)), "x");
  });
});
