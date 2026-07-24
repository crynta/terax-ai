import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  watchAdd: vi.fn(),
  watchRemove: vi.fn(),
  listenFsChanged: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  invoke: mocks.invoke,
}));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => ({ kind: "local" }),
}));
vi.mock("@/modules/explorer/lib/watch", () => ({
  watchAdd: mocks.watchAdd,
  watchRemove: mocks.watchRemove,
  listenFsChanged: mocks.listenFsChanged,
}));

import { type Status, syncPreviewFile } from "./MarkdownPreviewPane";

const here = path.dirname(fileURLToPath(import.meta.url));
const paneSrc = readFileSync(
  path.join(here, "MarkdownPreviewPane.tsx"),
  "utf8",
);
const renderSrc = readFileSync(path.join(here, "RenderedMarkdown.tsx"), "utf8");
const themeCss = readFileSync(path.join(here, "markdown-theme.css"), "utf8");

describe("markdown preview configuration", () => {
  it("renders through Streamdown in static mode (#913 invariant)", () => {
    expect(renderSrc).toMatch(/mode="static"/);
    expect(renderSrc).toMatch(/parseIncompleteMarkdown=\{false\}/);
  });

  it("disables Streamdown's link-safety popup in favor of the a policy", () => {
    expect(renderSrc).toMatch(/linkSafety=\{LINK_SAFETY_OFF\}/);
    expect(renderSrc).toMatch(/enabled: false/);
  });

  it("loads the base stylesheet before the Terax theme mapping", () => {
    const base = renderSrc.indexOf('import "./markdown-base.css"');
    const theme = renderSrc.indexOf('import "./markdown-theme.css"');
    expect(base).toBeGreaterThan(-1);
    expect(theme).toBeGreaterThan(base);
  });

  it("scopes GitHub styles to a markdown-body container", () => {
    expect(paneSrc).toMatch(/className="markdown-body/);
  });

  it("keeps code blocks on the app's Lezer renderer", () => {
    expect(renderSrc).toMatch(/code: .*MarkdownCode/);
  });

  it("renders inline HTML only through the sanitizer, then harden, last", () => {
    expect(renderSrc).toMatch(
      /defaultRehypePlugins\.raw,\s*rehypeTableDirectives,\s*rehypeGithubAlerts,\s*rehypeHeadingAnchors,\s*\[rehypeLocalImages, imageBase\],\s*\[rehypeSanitize, sanitizeSchema\],\s*\[\s*rehypeHarden,/,
    );
    expect(renderSrc).toMatch(/rehypePlugins=\{plugins\}/);
    expect(renderSrc).toMatch(/buildRehypePlugins\(baseDir\)/);
  });

  it("threads the document directory into the image resolver", () => {
    expect(paneSrc).toMatch(/baseDir=\{parentDir\(path\)\}/);
  });

  it("wires the watcher-backed loader as the pane's only read path", () => {
    expect(paneSrc).toMatch(
      /useEffect\(\(\) => syncPreviewFile\(path, setStatus\), \[path\]\)/,
    );
    // One invoke site: refresh reuses the same read, so there is no second
    // code path that could reintroduce a loading flash.
    expect(paneSrc.match(/invoke</g)).toHaveLength(1);
  });

  it("extends the sanitizer allowlist only with enumerated values", () => {
    expect(renderSrc).toMatch(
      /tagNames: \[\.\.\.\(streamdownSchema\.tagNames \?\? \[\]\), "colgroup", "col"\]/,
    );
    // Alert classes are enumerated per element, never a blanket allowance.
    expect(renderSrc).toContain('"markdown-alert-title"');
    expect(renderSrc).toContain('"markdown-alert-caution"');
    expect(renderSrc).not.toMatch(/\[\s*"className"\s*\]/);
    // Image URL schemes gain exactly the asset protocol, nothing broader.
    expect(renderSrc).toMatch(
      /src: \[\.\.\.\(streamdownSchema\.protocols\?\.src \?\? \[\]\), "asset"\]/,
    );
  });

  it("contains render failures to the pane with an error boundary", () => {
    expect(renderSrc).toMatch(/getDerivedStateFromError/);
  });

  it("opens links in the OS browser instead of navigating the webview", () => {
    expect(renderSrc).toMatch(/openUrl/);
    expect(renderSrc).toMatch(/preventDefault/);
  });

  // Fragment resolution is pane-scoped (multiple previews stay mounted with
  // duplicate heading ids); the scroll call itself is locked here because
  // the node test environment cannot observe scrollIntoView.
  it("scrolls fragment links in-pane, before the openUrl branch", () => {
    expect(renderSrc).toMatch(/href\.startsWith\("#"\)/);
    expect(renderSrc).toMatch(
      /resolveFragment\(e\.currentTarget, href\.slice\(1\)\)\?\.scrollIntoView\(\)/,
    );
    expect(renderSrc.indexOf('href.startsWith("#")')).toBeLessThan(
      renderSrc.indexOf("OPENABLE_URL.test(href)"),
    );
  });
});

describe("markdown-theme.css theme mapping", () => {
  it("maps GitHub color variables to Terax theme tokens", () => {
    expect(themeCss).toMatch(/--fgColor-default: var\(--foreground\)/);
    expect(themeCss).toMatch(/--bgColor-default: var\(--background\)/);
    expect(themeCss).toMatch(/--borderColor-default: var\(--border\)/);
  });

  it("restores list markers removed by Tailwind's preflight reset", () => {
    expect(themeCss).toMatch(/\.markdown-body ul \{\s*list-style-type: disc/);
    expect(themeCss).toMatch(
      /\.markdown-body ol \{\s*list-style-type: decimal/,
    );
  });

  it("honors standard table width markup GitHub ignores", () => {
    expect(themeCss).toMatch(
      /table\[width="100%"\] \{\s*display: table;\s*width: 100%/,
    );
    expect(themeCss).toMatch(/:has\(> colgroup\) \{\s*table-layout: fixed/);
  });

  it("underlines links so they read as links under monochrome themes", () => {
    expect(themeCss).toMatch(
      /\.markdown-body a \{\s*font-weight: 600;\s*text-decoration: underline/,
    );
  });

  it("keeps GitHub pre/code styles out of ChatCodeBlock internals", () => {
    expect(themeCss).toMatch(/\.markdown-body \.not-prose pre/);
    expect(themeCss).toMatch(/revert-layer/);
  });

  it("switches status hues on the app theme class, not the OS media query", () => {
    expect(themeCss).toMatch(/\.dark \.markdown-body/);
    expect(themeCss).toMatch(/\.light \.markdown-body/);
    expect(themeCss).not.toMatch(/@media/);
  });
});

type Deferred = {
  promise: Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
};

function deferred(): Deferred {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const text = (content: string) => ({ kind: "text", content, size: 1 });

describe("syncPreviewFile refresh on external change", () => {
  const FILE = "D:/notes/readme.md";
  let reads: Deferred[];
  let statuses: Status[];
  let fsHandler: (paths: string[]) => void;
  let unlisten: Mock<() => void>;

  beforeEach(() => {
    reads = [];
    statuses = [];
    unlisten = vi.fn<() => void>();
    mocks.invoke.mockReset().mockImplementation(() => {
      const d = deferred();
      reads.push(d);
      return d.promise;
    });
    mocks.watchAdd.mockReset();
    mocks.watchRemove.mockReset();
    mocks.listenFsChanged.mockReset().mockImplementation((h) => {
      fsHandler = h;
      return Promise.resolve(unlisten);
    });
  });

  const start = () => syncPreviewFile(FILE, (s) => statuses.push(s));

  it("watches the parent directory and removes the same path on cleanup", async () => {
    const stop = start();
    await flush();
    expect(mocks.watchAdd).toHaveBeenCalledExactlyOnceWith(["D:/notes"]);
    expect(mocks.watchRemove).not.toHaveBeenCalled();
    expect(unlisten).not.toHaveBeenCalled();
    stop();
    expect(mocks.watchRemove).toHaveBeenCalledExactlyOnceWith(
      mocks.watchAdd.mock.calls[0][0],
    );
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("disposes a listener that resolves after cleanup (rapid path switch)", async () => {
    let resolveListen!: (un: () => void) => void;
    mocks.listenFsChanged.mockImplementation(
      () => new Promise((res) => (resolveListen = res)),
    );
    const stop = start();
    stop();
    resolveListen(unlisten);
    await flush();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("re-reads on a change event for the file, ignoring sibling paths", async () => {
    start();
    reads[0].resolve(text("v1"));
    await flush();
    expect(mocks.invoke).toHaveBeenCalledOnce();

    fsHandler(["D:/notes/other.md"]);
    expect(mocks.invoke).toHaveBeenCalledOnce();

    // Backend emits canonical paths, backslashed on Windows.
    fsHandler(["D:\\notes\\readme.md"]);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("keeps the ready content on screen during a refresh (no loading flash)", async () => {
    start();
    reads[0].resolve(text("v1"));
    await flush();
    expect(statuses).toEqual([
      { kind: "loading" },
      { kind: "ready", content: "v1" },
    ]);

    fsHandler([FILE]);
    await flush();
    // Re-read in flight: no state change at all, so React never remounts.
    expect(statuses).toHaveLength(2);

    reads[1].resolve(text("v2"));
    await flush();
    expect(statuses[2]).toMatchObject({ kind: "ready", content: "v2" });
    expect(statuses.filter((s) => s.kind === "loading")).toHaveLength(1);
  });

  it("drops a slow read that finishes after a newer read started", async () => {
    start();
    reads[0].resolve(text("v1"));
    await flush();

    fsHandler([FILE]);
    fsHandler([FILE]);
    reads[2].resolve(text("v3"));
    await flush();
    reads[1].resolve(text("v2"));
    await flush();

    expect(statuses[statuses.length - 1]).toMatchObject({
      kind: "ready",
      content: "v3",
    });
    expect(statuses.some((s) => s.kind === "ready" && s.content === "v2")).toBe(
      false,
    );
  });

  it("moves to the error state when the file is deleted", async () => {
    start();
    reads[0].resolve(text("v1"));
    await flush();

    fsHandler([FILE]);
    reads[1].reject("no such file");
    await flush();
    expect(statuses[statuses.length - 1]).toEqual({
      kind: "error",
      message: "no such file",
    });
  });

  it("ignores reads and events resolving after cleanup", async () => {
    const stop = start();
    await flush();
    stop();
    reads[0].resolve(text("v1"));
    fsHandler([FILE]);
    await flush();
    expect(statuses).toEqual([{ kind: "loading" }]);
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });
});
