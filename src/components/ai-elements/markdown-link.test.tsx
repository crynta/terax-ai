import { afterEach, describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import { openMarkdownLink } from "./markdown-link";

describe("MarkdownLink", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens through the native opener and settles after success", async () => {
    openUrl.mockResolvedValue(undefined);
    const onSettled = vi.fn();

    await openMarkdownLink("https://chatgpt.com/codex/settings/usage", onSettled);

    expect(openUrl).toHaveBeenCalledWith(
      "https://chatgpt.com/codex/settings/usage",
    );
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it("still settles when opening fails", async () => {
    openUrl.mockRejectedValue(new Error("browser unavailable"));
    const onSettled = vi.fn();

    await openMarkdownLink("https://example.com", onSettled);

    expect(onSettled).toHaveBeenCalledOnce();
  });
});
