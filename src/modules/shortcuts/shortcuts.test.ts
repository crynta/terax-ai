import { describe, expect, it } from "vitest";

import {
  SHORTCUTS,
  shouldDeferForTerminalFocus,
  type Shortcut,
} from "./shortcuts";

const evt = (shiftKey: boolean): KeyboardEvent =>
  ({ shiftKey }) as unknown as KeyboardEvent;

const findShortcut = (id: Shortcut["id"]): Shortcut => {
  const s = SHORTCUTS.find((x) => x.id === id);
  if (!s) throw new Error(`test setup: missing shortcut ${id}`);
  return s;
};

describe("shouldDeferForTerminalFocus", () => {
  it("never defers when TUI passthrough is disabled (even inside a terminal)", () => {
    const s = findShortcut("commandPalette.open");
    expect(shouldDeferForTerminalFocus(s, evt(false), { enabled: false, inTerminal: true })).toBe(false);
  });

  it("never defers a terminalAlwaysOn shortcut (Find in files)", () => {
    const s = findShortcut("commandPalette.content");
    expect(shouldDeferForTerminalFocus(s, evt(true), { enabled: true, inTerminal: true })).toBe(false);
  });

  it("never defers a terminalAlwaysOn shortcut (toggleTuiFocus itself)", () => {
    const s = findShortcut("terminal.toggleTuiFocus");
    expect(shouldDeferForTerminalFocus(s, evt(false), { enabled: true, inTerminal: true })).toBe(false);
  });

  it("defers sidebar.toggle plain binding when terminal is focused", () => {
    const s = findShortcut("sidebar.toggle");
    expect(shouldDeferForTerminalFocus(s, evt(false), { enabled: true, inTerminal: true })).toBe(true);
  });

  it("does NOT defer sidebar.toggle Shift binding when terminal is focused", () => {
    const s = findShortcut("sidebar.toggle");
    expect(shouldDeferForTerminalFocus(s, evt(true), { enabled: true, inTerminal: true })).toBe(false);
  });

  it("does NOT defer sidebar.toggle plain binding when terminal is NOT focused", () => {
    const s = findShortcut("sidebar.toggle");
    expect(shouldDeferForTerminalFocus(s, evt(false), { enabled: true, inTerminal: false })).toBe(false);
  });

  it("defers a generic shortcut (commandPalette.open) when terminal is focused", () => {
    const s = findShortcut("commandPalette.open");
    expect(shouldDeferForTerminalFocus(s, evt(false), { enabled: true, inTerminal: true })).toBe(true);
  });

  it("does NOT defer a generic shortcut when terminal is NOT focused", () => {
    const s = findShortcut("commandPalette.open");
    expect(shouldDeferForTerminalFocus(s, evt(false), { enabled: true, inTerminal: false })).toBe(false);
  });
});
