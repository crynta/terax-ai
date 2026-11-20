import { openExternalUrl } from "@/lib/external-link";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveMarkdownDocPath,
  resolveMarkdownDocTarget,
} from "./MarkdownLink";

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

describe("MarkdownLink", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    "https://chatgpt.com/codex/settings/usage",
    "mailto:support@example.com",
    "tel:+16045550123",
  ])("opens supported links natively: %s", async (href) => {
    openUrl.mockResolvedValue(undefined);
    const onSettled = vi.fn();

    await openExternalUrl(href, onSettled);

    expect(openUrl).toHaveBeenCalledWith(href);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it("still settles when opening fails", async () => {
    openUrl.mockRejectedValue(new Error("browser unavailable"));
    const onSettled = vi.fn();

    await openExternalUrl("https://example.com", onSettled);

    expect(onSettled).toHaveBeenCalledOnce();
  });

  it("does not invoke the native opener for unsupported schemes", async () => {
    const onSettled = vi.fn();

    await openExternalUrl("javascript:alert(1)", onSettled);

    expect(openUrl).not.toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalledOnce();
  });


  it("resolves relative document links against the markdown file path", () => {
    expect(
      resolveMarkdownDocPath("/w/docs/readme.md", "./other.md", "./other.md"),
    ).toBe("/w/docs/other.md");
    expect(
      resolveMarkdownDocPath("/w/docs/readme.md", "other.md", "./other.md"),
    ).toBe("/w/docs/other.md");
    expect(
      resolveMarkdownDocPath("/w/docs/readme.md", "https://example.com"),
    ).toBeNull();
  });

  it("preserves document link fragments separately from the file path", () => {
    expect(
      resolveMarkdownDocTarget("/w/docs/readme.md", "./guide.md#install"),
    ).toEqual({ path: "/w/docs/guide.md", fragment: "install" });
    expect(
      resolveMarkdownDocTarget("/w/docs/readme.md", "guide.md#"),
    ).toEqual({ path: "/w/docs/guide.md" });
    expect(resolveMarkdownDocTarget("/w/docs/readme.md", "guide.md")).toEqual({
      path: "/w/docs/guide.md",
    });
    expect(
      resolveMarkdownDocTarget("/w/docs/readme.md", "#install"),
    ).toEqual({ path: "/w/docs/readme.md", fragment: "install" });
    expect(resolveMarkdownDocTarget("/w/docs/readme.md", "#")).toBeNull();
    expect(
      resolveMarkdownDocTarget("/w/docs/readme.md", "https://example.com#x"),
    ).toBeNull();
  });
});
