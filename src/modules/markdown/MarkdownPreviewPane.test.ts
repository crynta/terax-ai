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

  // Sanitize/harden placement is proven behaviorally in localImages.test
  // and githubAlerts.test; this only pins the relative order of the chain,
  // insensitive to formatting.
  it("renders inline HTML only through the sanitizer, then harden, last", () => {
    const chain = renderSrc.slice(
      renderSrc.indexOf("export const buildRehypePlugins"),
    );
    const positions = [
      "defaultRehypePlugins.raw",
      "rehypeTableDirectives",
      "rehypeGithubAlerts",
      "rehypeHeadingAnchors",
      "rehypeLocalImages",
      "rehypeSanitize",
      "rehypeHarden",
    ].map((id) => chain.indexOf(id));
    for (let i = 0; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(i === 0 ? -1 : positions[i - 1]);
    }
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
});

describe("markdown-theme.css theme mapping", () => {
  // The stylesheet must never key off the OS media query: the app theme
  // class (.dark/.light) has to win regardless of the OS setting.
  it("switches status hues on the app theme class, not the OS media query", () => {
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

  it("leaves ready when a refresh finds the file turned binary", async () => {
    start();
    reads[0].resolve(text("v1"));
    await flush();

    fsHandler([FILE]);
    reads[1].resolve({ kind: "binary", size: 8 });
    await flush();
    expect(statuses[statuses.length - 1]).toEqual({ kind: "binary" });
  });

  it("leaves ready when a refresh finds the file grown past the limit", async () => {
    start();
    reads[0].resolve(text("v1"));
    await flush();

    fsHandler([FILE]);
    reads[1].resolve({ kind: "toolarge", size: 99, limit: 10 });
    await flush();
    expect(statuses[statuses.length - 1]).toEqual({
      kind: "toolarge",
      size: 99,
      limit: 10,
    });
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
