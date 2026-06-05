import { describe, expect, it, vi } from "vitest";

// The module instantiates a LazyStore lazily; stub the plugin so importing the
// pure core never reaches the Tauri bridge in unit tests.
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    get = vi.fn().mockResolvedValue(undefined);
    set = vi.fn().mockResolvedValue(undefined);
    save = vi.fn().mockResolvedValue(undefined);
  },
}));

import { CommandRing } from "./commandHistory";

describe("CommandRing", () => {
  it("returns null for an empty prefix", () => {
    const ring = new CommandRing(10, ["git status"]);
    expect(ring.suggest("")).toBeNull();
  });

  it("suggests the most-recent command extending the prefix", () => {
    const ring = new CommandRing();
    ring.add("git status");
    ring.add("git commit -m wip");
    expect(ring.suggest("git ")).toBe("git commit -m wip");
  });

  it("never suggests a command equal to the prefix", () => {
    const ring = new CommandRing();
    ring.add("ls");
    expect(ring.suggest("ls")).toBeNull();
  });

  it("matches by prefix, not substring", () => {
    const ring = new CommandRing();
    ring.add("cargo build");
    expect(ring.suggest("build")).toBeNull();
  });

  it("dedupes and promotes a re-run command to most-recent", () => {
    const ring = new CommandRing();
    ring.add("npm run dev");
    ring.add("npm test");
    ring.add("npm run dev");
    expect(ring.suggest("npm ")).toBe("npm run dev");
    expect(ring.size).toBe(2);
  });

  it("ignores empty and whitespace-only commands", () => {
    const ring = new CommandRing();
    ring.add("   ");
    ring.add("");
    expect(ring.size).toBe(0);
  });

  it("trims surrounding whitespace before storing", () => {
    const ring = new CommandRing();
    ring.add("  pwd  ");
    expect(ring.suggest("pw")).toBe("pwd");
  });

  it("enforces the max size, dropping the oldest", () => {
    const ring = new CommandRing(2);
    ring.add("a-one");
    ring.add("b-two");
    ring.add("c-three");
    expect(ring.size).toBe(2);
    expect(ring.suggest("a-")).toBeNull();
    expect(ring.suggest("c-")).toBe("c-three");
  });

  it("hydrates oldest-first and round-trips through toArray", () => {
    const ring = new CommandRing(10, ["old", "mid", "new"]);
    expect(ring.toArray()).toEqual(["old", "mid", "new"]);
    // "new" was added last, so it wins a shared prefix.
    const tie = new CommandRing(10, ["git a", "git b"]);
    expect(tie.suggest("git ")).toBe("git b");
  });
});
