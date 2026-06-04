import { describe, expect, it, vi } from "vitest";
import {
  readClipboardText,
  writeClipboardText,
  type ClipboardAdapter,
} from "./clipboard";

function adapter(overrides: Partial<ClipboardAdapter> = {}): ClipboardAdapter {
  return {
    readText: vi.fn(() => Promise.resolve("")),
    writeText: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe("clipboard", () => {
  it("writes through the Tauri clipboard backend", async () => {
    const primary = adapter();

    await writeClipboardText("selected text", primary, null);

    expect(primary.writeText).toHaveBeenCalledWith("selected text");
  });

  it("falls back when the Tauri clipboard backend is unavailable", async () => {
    const primary = adapter({
      writeText: vi.fn(() => Promise.reject(new Error("unavailable"))),
    });
    const fallback = adapter();

    await writeClipboardText("selected text", primary, fallback);

    expect(fallback.writeText).toHaveBeenCalledWith("selected text");
  });

  it("reads through the fallback when the Tauri backend is unavailable", async () => {
    const primary = adapter({
      readText: vi.fn(() => Promise.reject(new Error("unavailable"))),
    });
    const fallback = adapter({
      readText: vi.fn(() => Promise.resolve("clipboard text")),
    });

    await expect(readClipboardText(primary, fallback)).resolves.toBe(
      "clipboard text",
    );
  });
});
