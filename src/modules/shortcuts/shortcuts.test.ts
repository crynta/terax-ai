import { describe, expect, it } from "vitest";
import { MOD_PROP } from "@/lib/platform";
import { getBindingTokens, SHORTCUTS } from "./shortcuts";

const shortcutsById = new Map(
  SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]),
);

describe("composer shortcuts", () => {
  it("registers toggle, send, and queue shortcuts in the Composer group", () => {
    expect(shortcutsById.get("terminalComposer.toggle")?.group).toBe(
      "Composer",
    );
    expect(shortcutsById.get("terminalComposer.send")?.group).toBe("Composer");
    expect(shortcutsById.get("terminalComposer.queue")?.group).toBe("Composer");
  });

  it("documents the default composer editor bindings", () => {
    expect(
      getBindingTokens(
        shortcutsById.get("terminalComposer.send")?.defaultBindings[0],
      ),
    ).toContain("Enter");
    expect(
      getBindingTokens(
        shortcutsById.get("terminalComposer.queue")?.defaultBindings[0],
      ),
    ).toContain("Enter");
    expect(
      shortcutsById.get("terminalComposer.queue")?.defaultBindings[0]?.shift,
    ).toBe(true);
  });

  it("uses the platform primary modifier for composer defaults", () => {
    for (const id of [
      "terminalComposer.toggle",
      "terminalComposer.send",
      "terminalComposer.queue",
      "terminalComposer.sendQueued",
    ] as const) {
      const binding = shortcutsById.get(id)?.defaultBindings[0];
      expect(binding?.[MOD_PROP]).toBe(true);
      expect(binding?.[MOD_PROP === "meta" ? "ctrl" : "meta"]).not.toBe(true);
    }
  });
});
