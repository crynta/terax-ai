import { afterEach, describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import { createTerminalLinkHandler } from "./terminalLinks";

describe("createTerminalLinkHandler", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens OSC 8 https links natively and restores late-bound terminal focus", async () => {
    openUrl.mockResolvedValue(undefined);
    const initialFocus = vi.fn();
    let focus = initialFocus;
    const handler = createTerminalLinkHandler(() => focus());
    focus = vi.fn();

    handler.activate(
      {} as MouseEvent,
      "https://chatgpt.com/codex/settings/usage",
    );

    expect(openUrl).toHaveBeenCalledWith(
      "https://chatgpt.com/codex/settings/usage",
    );
    await vi.waitFor(() => expect(focus).toHaveBeenCalledOnce());
    expect(initialFocus).not.toHaveBeenCalled();
  });

  it("allows non-http OSC 8 protocols and opens file URLs", async () => {
    openUrl.mockResolvedValue(undefined);
    const focus = vi.fn();
    const handler = createTerminalLinkHandler(focus);

    expect(handler.allowNonHttpProtocols).toBe(true);

    handler.activate({} as MouseEvent, "file:///Users/me/project/README.md");

    expect(openUrl).toHaveBeenCalledWith("file:///Users/me/project/README.md");
    await vi.waitFor(() => expect(focus).toHaveBeenCalledOnce());
  });

  it("does not open javascript: OSC 8 payloads", async () => {
    openUrl.mockResolvedValue(undefined);
    const focus = vi.fn();
    const handler = createTerminalLinkHandler(focus);

    handler.activate({} as MouseEvent, "javascript:alert(1)");

    expect(openUrl).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledOnce();
  });
});