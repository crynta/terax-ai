import { describe, expect, it, vi } from "vitest";
import { handOffThemeEdit, starterTheme } from "./themeFiles";

describe("starterTheme", () => {
  it("exposes terminal font settings in newly created themes", () => {
    expect(starterTheme().variants.dark?.terminal).toMatchObject({
      fontFamily: "JetBrains Mono",
      fontWeight: "normal",
      fontSize: 14,
    });
  });
});

describe("handOffThemeEdit", () => {
  it("emits the request before closing the settings window", async () => {
    const calls: string[] = [];
    const emit = vi.fn(async () => {
      await Promise.resolve();
      calls.push("emit");
    });
    const close = vi.fn(async () => {
      calls.push("close");
    });
    await expect(
      handOffThemeEdit({ action: "edit", id: "mine" }, close, emit),
    ).resolves.toBe(true);
    expect(emit).toHaveBeenCalledWith({ action: "edit", id: "mine" });
    expect(calls).toEqual(["emit", "close"]);
  });

  it("keeps Settings open when the request cannot be delivered", async () => {
    const close = vi.fn(async () => undefined);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      handOffThemeEdit({ action: "create" }, close, async () => {
        throw new Error("bus down");
      }),
    ).resolves.toBe(false);
    expect(close).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("still reports delivery when the window refuses to close", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      handOffThemeEdit(
        { action: "create" },
        async () => {
          throw new Error("denied");
        },
        async () => undefined,
      ),
    ).resolves.toBe(true);
    spy.mockRestore();
  });
});
