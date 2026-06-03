import { describe, expect, it, vi } from "vitest";
import {
  readTerminalClipboardText,
  writeTerminalClipboardText,
} from "@/modules/terminal/lib/clipboard";

describe("terminal clipboard helpers", () => {
  it("prefers the native clipboard for paste", async () => {
    const webReadText = vi.fn().mockResolvedValue("stale-web-copy");
    const nativeReadText = vi.fn().mockResolvedValue("external-system-copy");

    await expect(
      readTerminalClipboardText({
        nativeReadText,
        webClipboard: { readText: webReadText, writeText: vi.fn() },
      }),
    ).resolves.toBe("external-system-copy");

    expect(nativeReadText).toHaveBeenCalledTimes(1);
    expect(webReadText).not.toHaveBeenCalled();
  });

  it("falls back to the web clipboard when native read fails", async () => {
    const webReadText = vi.fn().mockResolvedValue("browser-copy");

    await expect(
      readTerminalClipboardText({
        nativeReadText: vi.fn().mockRejectedValue(new Error("native failed")),
        webClipboard: { readText: webReadText, writeText: vi.fn() },
      }),
    ).resolves.toBe("browser-copy");

    expect(webReadText).toHaveBeenCalledTimes(1);
  });

  it("prefers the native clipboard for copy", async () => {
    const webWriteText = vi.fn().mockResolvedValue(undefined);
    const nativeWriteText = vi.fn().mockResolvedValue(undefined);

    await writeTerminalClipboardText("copied text", {
      nativeWriteText,
      webClipboard: { readText: vi.fn(), writeText: webWriteText },
    });

    expect(nativeWriteText).toHaveBeenCalledWith("copied text");
    expect(webWriteText).not.toHaveBeenCalled();
  });

  it("falls back to the web clipboard when native write fails", async () => {
    const webWriteText = vi.fn().mockResolvedValue(undefined);

    await writeTerminalClipboardText("copied text", {
      nativeWriteText: vi.fn().mockRejectedValue(new Error("native failed")),
      webClipboard: { readText: vi.fn(), writeText: webWriteText },
    });

    expect(webWriteText).toHaveBeenCalledWith("copied text");
  });
});
