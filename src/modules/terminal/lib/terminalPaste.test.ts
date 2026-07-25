import { describe, expect, it, vi } from "vitest";
import { pasteIntoTerminal } from "./terminalPaste";

describe("pasteIntoTerminal", () => {
  it("pastes and focuses the resolved terminal", () => {
    const terminal = { paste: vi.fn(), focus: vi.fn() };

    expect(pasteIntoTerminal(terminal, "/repo/file.ts ")).toBe(true);
    expect(terminal.paste).toHaveBeenCalledWith("/repo/file.ts ");
    expect(terminal.focus).toHaveBeenCalledOnce();
  });

  it("returns false when no terminal is resolved", () => {
    expect(pasteIntoTerminal(null, "/repo/file.ts ")).toBe(false);
  });
});
