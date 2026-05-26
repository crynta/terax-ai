import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// `convertFileSrc` and the DOM Image/canvas path are exercised at runtime in
// the renderer; the pure registry/resolution logic is what unit tests cover.
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
}));

// jsdom can't decode asset:// URLs, so generateThumb's caught error spams
// stderr. Silence the warn — the registry/resolution paths are what we test.
beforeAll(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

import {
  clearLeafImages,
  registerPastedImage,
  resetImagePromptCounter,
  resolveImageEntry,
} from "./imageThumbnails";

afterEach(() => {
  // Tests share module-level state; reset between runs.
  clearLeafImages(1);
  clearLeafImages(2);
});

const tempPath = (n: number) => `/tmp/terax-clipboard-1735000000${n}-1234.png`;

describe("registerPastedImage + resolveImageEntry — path 1:1", () => {
  it("matches a visible temp path token to the registered entry", () => {
    const p = tempPath(1);
    registerPastedImage(1, p);

    const e = resolveImageEntry(1, `cat ${p}`);
    expect(e?.path).toBe(p);
    expect(e?.promptSeq).toBe(1);
  });

  it("matches when the line shows only the filename", () => {
    registerPastedImage(1, tempPath(2));
    const e = resolveImageEntry(1, `[Image] terax-clipboard-17350000002-1234.png`);
    expect(e?.file).toBe("terax-clipboard-17350000002-1234.png");
  });

  it("prefers the most recent entry when two share a filename", () => {
    // Same basename pasted twice — return the latest registration.
    const p = tempPath(3);
    registerPastedImage(1, p);
    registerPastedImage(1, p);
    const e = resolveImageEntry(1, p);
    expect(e?.promptSeq).toBe(2);
  });
});

describe("[Image #N] correlation via per-prompt counter", () => {
  it("assigns promptSeq sequentially and resolves [Image #N]", () => {
    registerPastedImage(1, tempPath(1));
    registerPastedImage(1, tempPath(2));
    registerPastedImage(1, tempPath(3));

    expect(resolveImageEntry(1, "[Image #1]")?.path).toBe(tempPath(1));
    expect(resolveImageEntry(1, "[Image #2]")?.path).toBe(tempPath(2));
    expect(resolveImageEntry(1, "[Image #3]")?.path).toBe(tempPath(3));
  });

  it("resets the per-prompt counter on submit so #1 maps to the next paste", () => {
    registerPastedImage(1, tempPath(1));
    registerPastedImage(1, tempPath(2));
    expect(resolveImageEntry(1, "[Image #1]")?.path).toBe(tempPath(1));

    resetImagePromptCounter(1);
    registerPastedImage(1, tempPath(3));
    // After submit + new paste, [Image #1] now points to the new image.
    expect(resolveImageEntry(1, "[Image #1]")?.path).toBe(tempPath(3));
    // Earlier paste is still in the registry for path-token lookups.
    expect(resolveImageEntry(1, tempPath(1))?.path).toBe(tempPath(1));
  });

  it("returns undefined for [Image #N] with no matching entry", () => {
    registerPastedImage(1, tempPath(1));
    expect(resolveImageEntry(1, "[Image #7]")).toBeUndefined();
  });
});

describe("isolation between leaves and lifecycle", () => {
  it("does not leak entries across leaves", () => {
    registerPastedImage(1, tempPath(1));
    registerPastedImage(2, tempPath(2));

    expect(resolveImageEntry(1, "[Image #1]")?.path).toBe(tempPath(1));
    expect(resolveImageEntry(2, "[Image #1]")?.path).toBe(tempPath(2));
    // Leaf 1 never saw leaf 2's path.
    expect(resolveImageEntry(1, tempPath(2))).toBeUndefined();
  });

  it("clearLeafImages drops the leaf's registry", () => {
    registerPastedImage(1, tempPath(1));
    clearLeafImages(1);
    expect(resolveImageEntry(1, "[Image #1]")).toBeUndefined();
    expect(resolveImageEntry(1, tempPath(1))).toBeUndefined();
  });

  it("returns undefined for a leaf with no registry", () => {
    expect(resolveImageEntry(99, "[Image #1]")).toBeUndefined();
  });
});

describe("no false matches on unrelated text", () => {
  it("ignores tokens that don't match either pattern", () => {
    registerPastedImage(1, tempPath(1));
    expect(resolveImageEntry(1, "ls -la")).toBeUndefined();
    expect(resolveImageEntry(1, "[Image]")).toBeUndefined();
    expect(resolveImageEntry(1, "image.png")).toBeUndefined();
  });
});
