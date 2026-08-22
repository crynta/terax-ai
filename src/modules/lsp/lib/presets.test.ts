import { describe, expect, it } from "vitest";
import type { LspCustomServer } from "@/modules/settings/store";
import {
  allServers,
  LSP_PRESETS,
  serverById,
  serverForLanguage,
  serversForLanguage,
} from "./presets";

const customPy: LspCustomServer = {
  id: "my-py",
  name: "Mine",
  command: "x",
  args: [],
  languages: { py: "python" },
  rootMarkers: [],
};

describe("serversForLanguage", () => {
  it("returns the built-in servers that claim a language", () => {
    expect(serversForLanguage("py", []).map((p) => p.id)).toEqual([
      "pyright",
      "ruff",
    ]);
  });

  it("includes matching custom servers after the presets", () => {
    expect(serversForLanguage("py", [customPy]).map((p) => p.id)).toEqual([
      "pyright",
      "ruff",
      "my-py",
    ]);
  });

  it("returns nothing for a null or unknown language", () => {
    expect(serversForLanguage(null, [])).toEqual([]);
    expect(serversForLanguage("cobol", [])).toEqual([]);
  });
});

describe("serverForLanguage", () => {
  it("returns the first candidate when no activation is given", () => {
    expect(serverForLanguage("py", [])?.id).toBe("pyright");
  });

  it("prefers the enabled server over preset order", () => {
    expect(serverForLanguage("py", [], { ruff: "enabled" })?.id).toBe("ruff");
  });

  it("skips a dismissed server and offers the next fresh one", () => {
    expect(serverForLanguage("py", [], { pyright: "dismissed" })?.id).toBe(
      "ruff",
    );
  });

  it("returns null when nothing claims the language", () => {
    expect(serverForLanguage("cobol", [])).toBeNull();
  });
});

describe("serverById", () => {
  it("finds a preset by id", () => {
    expect(serverById("pyright", [])?.id).toBe("pyright");
  });

  it("finds a custom server by id", () => {
    expect(serverById("my-py", [customPy])?.name).toBe("Mine");
  });

  it("returns null for an unknown id", () => {
    expect(serverById("nope", [])).toBeNull();
  });
});

describe("allServers", () => {
  it("appends custom servers to the presets", () => {
    expect(allServers([customPy])).toHaveLength(LSP_PRESETS.length + 1);
  });
});
