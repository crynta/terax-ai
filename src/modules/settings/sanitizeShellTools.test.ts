import { describe, expect, it } from "vitest";
import { sanitizeShellTools } from "./store";

describe("sanitizeShellTools", () => {
  it("returns null for non-array input so the caller falls back to defaults", () => {
    expect(sanitizeShellTools(undefined)).toBeNull();
    expect(sanitizeShellTools(null)).toBeNull();
    expect(sanitizeShellTools({})).toBeNull();
    expect(sanitizeShellTools("nvim")).toBeNull();
  });

  it("drops entries without id, name or patterns", () => {
    const tools = sanitizeShellTools([
      null,
      42,
      { id: "a" },
      { id: "a", name: "A" },
      { id: "ok", name: "Ok", patterns: ["ok"], blockShortcuts: false },
    ]);
    expect(tools?.map((t) => t.id)).toEqual(["ok"]);
  });

  it("filters malformed shortcut overrides that would hit the keydown matcher", () => {
    const tools = sanitizeShellTools([
      {
        id: "nvim",
        name: "Neovim",
        patterns: ["nvim", 7],
        blockShortcuts: "yes",
        shortcutMode: "sometimes",
        blockedShortcuts: "ai.toggle",
        shortcutOverrides: {
          "ai.toggle": [{ key: "i", meta: true }, { key: "" }, "ctrl+i", null],
          "view.zenMode": "not-an-array",
        },
      },
    ]);
    const t = tools?.[0];
    expect(t?.patterns).toEqual(["nvim"]);
    expect(t?.blockShortcuts).toBe(false);
    expect(t?.shortcutMode).toBeUndefined();
    expect(t?.blockedShortcuts).toBeUndefined();
    expect(t?.shortcutOverrides).toEqual({
      "ai.toggle": [{ key: "i", meta: true }],
    });
  });

  it("clamps padding and drops non-finite font sizes", () => {
    const tools = sanitizeShellTools([
      {
        id: "htop",
        name: "htop",
        patterns: ["htop"],
        blockShortcuts: true,
        padding: 10_000,
        fontSize: Number.NaN,
      },
    ]);
    const t = tools?.[0];
    expect(t?.blockShortcuts).toBe(true);
    expect(Number.isFinite(t?.padding)).toBe(true);
    expect(t?.padding).toBeLessThan(10_000);
    expect(t?.fontSize).toBeUndefined();
  });

  it("keeps well-formed tools intact", () => {
    const tool = {
      id: "zellij",
      name: "Zellij",
      patterns: ["zellij"],
      blockShortcuts: false,
      shortcutMode: "custom" as const,
      blockedShortcuts: ["ai.toggle"],
      shortcutOverrides: { "view.zenMode": [{ key: "z", ctrl: true }] },
      padding: 0,
      hideStatusBar: "disable" as const,
    };
    expect(sanitizeShellTools([tool])?.[0]).toEqual(tool);
  });
});
