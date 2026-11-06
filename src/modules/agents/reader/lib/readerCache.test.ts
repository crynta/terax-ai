import { beforeEach, describe, expect, it } from "vitest";
import {
  bufferFor,
  cachedBuffer,
  clearReaderCache,
  savedScroll,
  saveScroll,
} from "./readerCache";

beforeEach(clearReaderCache);

describe("reader cache", () => {
  it("hands back the same buffer for a session, so a remount resumes it", () => {
    const first = bufferFor("s1");
    expect(cachedBuffer("s1")).toBe(first);
    expect(bufferFor("s1")).toBe(first);
    expect(cachedBuffer("s2")).toBeNull();
  });

  it("keeps the 8 most recently used sessions", () => {
    for (let i = 0; i < 9; i++) bufferFor(`s${i}`);
    expect(cachedBuffer("s0")).toBeNull();
    expect(cachedBuffer("s8")).not.toBeNull();
    // Using s1 again makes it recent, so s2 is the next to go.
    bufferFor("s1");
    bufferFor("s9");
    expect(cachedBuffer("s1")).not.toBeNull();
    expect(cachedBuffer("s2")).toBeNull();
  });

  it("remembers scroll per pane and session", () => {
    saveScroll(1, "s1", { top: 420, following: false });
    expect(savedScroll(1, "s1")).toEqual({ top: 420, following: false });
    expect(savedScroll(2, "s1")).toBeNull();
  });
});
