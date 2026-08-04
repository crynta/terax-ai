import { afterEach, describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import { createTerminalLinkHandler } from "./terminalLinks";

describe("createTerminalLinkHandler", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens OSC 8 links natively and restores terminal focus", async () => {
    openUrl.mockResolvedValue(undefined);
    const focus = vi.fn();

    createTerminalLinkHandler(focus).activate(
      {} as MouseEvent,
      "https://chatgpt.com/codex/settings/usage",
    );

    expect(openUrl).toHaveBeenCalledWith(
      "https://chatgpt.com/codex/settings/usage",
    );
    await vi.waitFor(() => expect(focus).toHaveBeenCalledOnce());
  });

  it("does not open unsupported OSC 8 schemes", () => {
    const focus = vi.fn();

    createTerminalLinkHandler(focus).activate(
      {} as MouseEvent,
      "javascript:alert(1)",
    );

    expect(openUrl).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledOnce();
  });
});
