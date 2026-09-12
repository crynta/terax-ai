import { beforeEach, describe, expect, it, vi } from "vitest";

const opener = vi.hoisted(() => ({
  openUrl: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/plugin-opener", () => opener);

import {
  isExternalUrl,
  isTerminalOpenableUrl,
  openExternalUrl,
  openTerminalUrl,
} from "./external-link";

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

describe("isTerminalOpenableUrl", () => {
  it("accepts the external schemes plus file", () => {
    expect(isTerminalOpenableUrl("https://example.com")).toBe(true);
    expect(isTerminalOpenableUrl("mailto:a@b.c")).toBe(true);
    expect(isTerminalOpenableUrl("file:///Users/me/readme.md")).toBe(true);
    expect(isTerminalOpenableUrl("FILE:///C:/Users/me/readme.md")).toBe(true);
  });

  it("still refuses executable schemes", () => {
    expect(isTerminalOpenableUrl("javascript:void(0)")).toBe(false);
    expect(isTerminalOpenableUrl("data:text/html,hi")).toBe(false);
    expect(isTerminalOpenableUrl("/settings/general")).toBe(false);
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

  it("does not open file URLs (markdown / shared path)", async () => {
    const settled = vi.fn();

    await openExternalUrl("file:///Users/me/readme.md", settled);

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

describe("openTerminalUrl", () => {
  beforeEach(() => {
    opener.openUrl.mockClear();
  });

  it("opens https and file URLs through the opener plugin", async () => {
    const settled = vi.fn();

    await openTerminalUrl("https://example.com", settled);
    await openTerminalUrl("file:///Users/me/readme.md", settled);

    expect(opener.openUrl).toHaveBeenCalledWith("https://example.com");
    expect(opener.openUrl).toHaveBeenCalledWith("file:///Users/me/readme.md");
    expect(settled).toHaveBeenCalledTimes(2);
  });

  it("skips javascript and data schemes", async () => {
    const settled = vi.fn();

    await openTerminalUrl("javascript:alert(1)", settled);
    await openTerminalUrl("data:text/html,hi", settled);

    expect(opener.openUrl).not.toHaveBeenCalled();
    expect(settled).toHaveBeenCalledTimes(2);
  });
});