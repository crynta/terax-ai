import { beforeEach, describe, expect, it, vi } from "vitest";

const opener = vi.hoisted(() => ({
  openUrl: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/plugin-opener", () => opener);

import { isExternalUrl, openExternalUrl } from "./external-link";

describe("isExternalUrl", () => {
  it("accepts web, mail, and phone schemes", () => {
    expect(isExternalUrl("https://example.com")).toBe(true);
    expect(isExternalUrl("HTTP://EXAMPLE.COM")).toBe(true);
    expect(isExternalUrl("mailto:a@b.c")).toBe(true);
    expect(isExternalUrl("tel:+1234")).toBe(true);
  });

  it("refuses app-relative and executable schemes", () => {
    expect(isExternalUrl("/settings/general")).toBe(false);
    expect(isExternalUrl("#anchor")).toBe(false);
    expect(isExternalUrl("javascript:void(0)")).toBe(false);
    expect(isExternalUrl("data:text/html,hi")).toBe(false);
    expect(isExternalUrl("file:///etc/passwd")).toBe(false);
  });
});

describe("openExternalUrl", () => {
  beforeEach(() => {
    opener.openUrl.mockClear();
  });

  it("opens external URLs through the opener plugin", async () => {
    const settled = vi.fn();

    await openExternalUrl("https://example.com", settled);

    expect(opener.openUrl).toHaveBeenCalledWith("https://example.com");
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("skips non-external URLs without touching the plugin", async () => {
    const settled = vi.fn();

    await openExternalUrl("javascript:void(0)", settled);

    expect(opener.openUrl).not.toHaveBeenCalled();
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("still settles when the opener fails", async () => {
    opener.openUrl.mockRejectedValueOnce(new Error("no handler"));
    const settled = vi.fn();

    await expect(
      openExternalUrl("https://example.com", settled),
    ).resolves.toBeUndefined();

    expect(settled).toHaveBeenCalledTimes(1);
  });
});
