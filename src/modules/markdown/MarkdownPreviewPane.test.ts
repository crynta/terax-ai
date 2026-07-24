import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultRehypePlugins } from "streamdown";
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

import { rehypeGithubAlerts } from "./githubAlerts";
import { rehypeHeadingAnchors } from "./headingAnchors";
import { rehypeLocalImages } from "./localImages";
import { type Status, syncPreviewFile } from "./MarkdownPreviewPane";
import {
  buildRehypePlugins,
  components,
  rehypePlugins,
  sanitizeSchema,
} from "./RenderedMarkdown";
import { rehypeTableDirectives } from "./tableDirectives";

const here = path.dirname(fileURLToPath(import.meta.url));
const paneSrc = readFileSync(
  path.join(here, "MarkdownPreviewPane.tsx"),
  "utf8",
);
const renderSrc = readFileSync(path.join(here, "RenderedMarkdown.tsx"), "utf8");

type Schema = {
  tagNames?: string[];
  attributes?: Record<string, unknown[]>;
  protocols?: Record<string, unknown[]>;
};

describe("markdown preview configuration", () => {
  // Order is load-bearing: sanitize must prune after every feature plugin
  // and harden must vet URLs last; asserted on the built array itself.
  it("pipeline order and sanitizer schema contract", () => {
    const plugins = buildRehypePlugins("D:/x") as unknown[];
    const [sanitizeFn, streamdownSchema] = defaultRehypePlugins.sanitize as [
      unknown,
      Schema,
    ];
    const [hardenFn] = defaultRehypePlugins.harden as [unknown, unknown];

    expect(plugins).toHaveLength(7);
    expect(plugins[0]).toBe(defaultRehypePlugins.raw);
    expect(plugins[1]).toBe(rehypeTableDirectives);
    expect(plugins[2]).toBe(rehypeGithubAlerts);
    expect(plugins[3]).toBe(rehypeHeadingAnchors);

    const local = plugins[4] as [unknown, unknown];
    expect(local[0]).toBe(rehypeLocalImages);
    expect(local[1]).toBe("D:/x");

    const sanitize = plugins[5] as [unknown, unknown];
    expect(sanitize[0]).toBe(sanitizeFn);
    expect(sanitize[1]).toBe(sanitizeSchema);

    const harden = plugins[6] as [unknown, Record<string, unknown>];
    expect(harden[0]).toBe(hardenFn);
    // Blocked URLs degrade to plain text: bare relative links are routine
    // in GitHub-authored files and the "[blocked]" badge reads as content.
    expect(harden[1].linkBlockPolicy).toBe("text-only");
    expect(harden[1].imageBlockPolicy).toBe("text-only");

    // The exported default chain and component map stay wired the same way.
    expect(rehypePlugins).toHaveLength(7);
    expect(typeof components.a).toBe("function");

    // Schema additions are enumerated on top of Streamdown's lists, never
    // broader.
    expect(sanitizeSchema.tagNames).toEqual([
      ...(streamdownSchema.tagNames ?? []),
      "colgroup",
      "col",
    ]);
    expect(sanitizeSchema.protocols.src).toEqual([
      ...(streamdownSchema.protocols?.src ?? []),
      "asset",
    ]);

    const attrs = sanitizeSchema.attributes as Record<string, unknown[]>;
    expect(attrs.div).toContainEqual([
      "className",
      "markdown-alert",
      "markdown-alert-note",
      "markdown-alert-tip",
      "markdown-alert-important",
      "markdown-alert-warning",
      "markdown-alert-caution",
    ]);
    expect(attrs.p).toContainEqual(["className", "markdown-alert-title"]);
    // A bare "className" entry would allow any class on that element.
    for (const list of Object.values(attrs)) {
      expect(list).not.toContain("className");
    }
  });

  // No behavioral cousin exists for these JSX props; pin the source text.
  it("RenderedMarkdown wiring pins", () => {
    expect(renderSrc).toMatch(/mode="static"/);
    expect(renderSrc).toMatch(/parseIncompleteMarkdown=\{false\}/);
    expect(renderSrc).toMatch(/linkSafety=\{LINK_SAFETY_OFF\}/);
    expect(renderSrc).toMatch(/enabled: false/);
    // The only guard that link clicks never navigate the privileged webview.
    expect(renderSrc).toMatch(/e\.preventDefault\(\)/);
    expect(renderSrc).toMatch(/openUrl/);
    expect(renderSrc).toMatch(/rehypePlugins=\{plugins\}/);
    expect(renderSrc).toMatch(/buildRehypePlugins\(baseDir\)/);
  });

  it("pane wiring pins", () => {
    expect(paneSrc).toMatch(/baseDir=\{parentDir\(path\)\}/);
    expect(paneSrc).toMatch(
      /useEffect\(\(\) => syncPreviewFile\(path, setStatus\), \[path\]\)/,
    );
    // One invoke site: refresh reuses the same read, so there is no second
    // code path that could reintroduce a loading flash.
    expect(paneSrc.match(/invoke</g)).toHaveLength(1);
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

  it("leaves ready when a refresh finds the file binary or past the limit", async () => {
    start();
    reads[0].resolve(text("v1"));
    await flush();

    fsHandler([FILE]);
    reads[1].resolve({ kind: "binary", size: 8 });
    await flush();
    expect(statuses[statuses.length - 1]).toEqual({ kind: "binary" });

    fsHandler([FILE]);
    reads[2].resolve({ kind: "toolarge", size: 99, limit: 10 });
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
