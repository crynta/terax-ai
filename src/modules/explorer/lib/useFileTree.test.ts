import { describe, expect, it } from "vitest";
import { directoryCacheKey, expansionCacheKey } from "./useFileTree";

describe("file tree cache keys", () => {
  it("scopes expansion by workspace and root", () => {
    expect(expansionCacheKey("local", "/Users/me")).toBe("local\0/Users/me");
    expect(expansionCacheKey("ssh:sean@host:22", "/home/sean")).toBe(
      "ssh:sean@host:22\0/home/sean",
    );
  });

  it("separates directory entries by hidden preference and path", () => {
    expect(directoryCacheKey("ssh:sean@host:22", false, "/home/sean")).toBe(
      ["ssh:sean@host:22", "0", "/home/sean"].join("\0"),
    );
    expect(directoryCacheKey("ssh:sean@host:22", true, "/home/sean")).toBe(
      ["ssh:sean@host:22", "1", "/home/sean"].join("\0"),
    );
  });
});
