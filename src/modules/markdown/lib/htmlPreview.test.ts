import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCoalescer,
  htmlPreviewAssetUrl,
  htmlPreviewSrc,
  htmlPreviewSupported,
  pathsInclude,
} from "./htmlPreview";

describe("htmlPreviewSupported", () => {
  it("allows local workspaces and tabs with no recorded environment", () => {
    expect(htmlPreviewSupported({ kind: "local" })).toBe(true);
    expect(htmlPreviewSupported(undefined)).toBe(true);
  });

  it("refuses WSL workspaces", () => {
    expect(htmlPreviewSupported({ kind: "wsl", distro: "Ubuntu" })).toBe(false);
  });
});

describe("createCoalescer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs once for a write event followed by the trailing watcher event", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const c = createCoalescer(fn, 300);
    c.trigger();
    vi.advanceTimersByTime(260);
    c.trigger();
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("runs again for a change after the window has closed", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const c = createCoalescer(fn, 300);
    c.trigger();
    vi.advanceTimersByTime(300);
    c.trigger();
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("never runs after cancel", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const c = createCoalescer(fn, 300);
    c.trigger();
    c.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});

// Mirrors the asset protocol handler: drop the leading `/`, percent-decode.
const servedPath = (url: string) =>
  decodeURIComponent(new URL(url).pathname.slice(1));

describe("htmlPreviewAssetUrl", () => {
  const mac = "asset://localhost/";
  const win = "http://asset.localhost/";

  it("keeps real slashes so relative URLs resolve beside the file", () => {
    const page = htmlPreviewAssetUrl(mac, "/Users/me/site/index.html");
    expect(new URL("css/site.css", page).href).toBe(
      htmlPreviewAssetUrl(mac, "/Users/me/site/css/site.css"),
    );
    expect(new URL("../shared/a.js", page).href).toBe(
      htmlPreviewAssetUrl(mac, "/Users/me/shared/a.js"),
    );
  });

  it("is served as the original absolute Unix path", () => {
    const url = htmlPreviewAssetUrl(mac, "/Users/me/site/index.html");
    expect(servedPath(url)).toBe("/Users/me/site/index.html");
  });

  it("encodes characters that would break the URL inside each segment", () => {
    const path = "/Users/me/my site/#1 ?draft%/index.html";
    const url = htmlPreviewAssetUrl(mac, path);
    expect(url).not.toMatch(/[ #?]/);
    expect(servedPath(url)).toBe(path);
  });

  it("serves Windows paths with forward slashes and the drive intact", () => {
    const url = htmlPreviewAssetUrl(win, "C:\\site\\index.html");
    expect(servedPath(url)).toBe("C:/site/index.html");
    expect(new URL("img/a.png", url).href).toBe(
      htmlPreviewAssetUrl(win, "C:/site/img/a.png"),
    );
  });
});

describe("pathsInclude", () => {
  it("matches the exact path", () => {
    expect(pathsInclude(["/a/b/index.html"], "/a/b/index.html")).toBe(true);
  });

  it("treats backslash and forward-slash separators as equal", () => {
    expect(pathsInclude(["C:/site/index.html"], "C:\\site\\index.html")).toBe(
      true,
    );
  });

  it("does not match the parent directory or a sibling", () => {
    expect(pathsInclude(["/a/b", "/a/b/other.html"], "/a/b/index.html")).toBe(
      false,
    );
  });

  it("is false for an empty change set", () => {
    expect(pathsInclude([], "/a/index.html")).toBe(false);
  });
});

describe("htmlPreviewSrc", () => {
  const asset = "asset://localhost/%2Fa%2Findex.html";

  it("returns the asset URL untouched for the first load", () => {
    expect(htmlPreviewSrc(asset, 0)).toBe(asset);
  });

  it("appends a revision query for reloads", () => {
    expect(htmlPreviewSrc(asset, 3)).toBe(`${asset}?v=3`);
  });

  it("extends an existing query instead of starting a second one", () => {
    expect(htmlPreviewSrc(`${asset}?x=1`, 2)).toBe(`${asset}?x=1&v=2`);
  });
});
