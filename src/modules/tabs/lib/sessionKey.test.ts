import { describe, expect, it } from "vitest";
import { sessionKey } from "./sessionKey";

describe("sessionKey", () => {
  it("combines launch dir and workspace scope", () => {
    expect(sessionKey("/Users/kalle/projects/foo", "local")).toBe(
      "/Users/kalle/projects/foo::local",
    );
  });

  it("uses 'default' when launch dir is undefined", () => {
    expect(sessionKey(undefined, "local")).toBe("default::local");
  });

  it("uses 'default' when launch dir is the empty string", () => {
    expect(sessionKey("", "local")).toBe("default::local");
  });

  it("includes the WSL distro in the workspace key", () => {
    expect(sessionKey("/srv/foo", "wsl:Ubuntu")).toBe("/srv/foo::wsl:Ubuntu");
  });
});
