import { describe, expect, it } from "vitest";
import {
  clampSidebarWidth,
  readStoredSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_STORAGE_KEYS,
  writeStoredSidebarWidth,
} from "./persistence";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class ThrowingStorage implements Pick<Storage, "getItem" | "setItem"> {
  getItem(): string | null {
    throw new Error("storage blocked");
  }

  setItem(): void {
    throw new Error("storage blocked");
  }
}

describe("sidebar persistence", () => {
  it("keeps the existing sidebar storage keys stable", () => {
    expect(SIDEBAR_STORAGE_KEYS.primaryWidth).toBe("terax.sidebar.width");
    expect(SIDEBAR_STORAGE_KEYS.primaryView).toBe("terax.sidebar.view");
    expect(SIDEBAR_STORAGE_KEYS.secondaryWidth).toBe(
      "terax.secondarySidebar.width",
    );
    expect(SIDEBAR_STORAGE_KEYS.secondaryView).toBe(
      "terax.secondarySidebar.view",
    );
    expect(SIDEBAR_STORAGE_KEYS.secondaryVisible).toBe(
      "terax.secondarySidebar.visible",
    );
  });

  it("clamps stored sidebar widths to the supported panel range", () => {
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH - 50)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH + 50)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampSidebarWidth(260.4)).toBe(260);
  });

  it("reads and writes panel widths without resetting existing users", () => {
    const storage = new MemoryStorage();

    expect(readStoredSidebarWidth(storage, "primary")).toBe(
      SIDEBAR_DEFAULT_WIDTH,
    );

    writeStoredSidebarWidth(storage, "secondary", SIDEBAR_MAX_WIDTH + 20);

    expect(storage.getItem(SIDEBAR_STORAGE_KEYS.secondaryWidth)).toBe("480");
    expect(readStoredSidebarWidth(storage, "secondary")).toBe(480);
  });

  it("falls back to the default width when storage reads are blocked", () => {
    expect(readStoredSidebarWidth(new ThrowingStorage(), "primary")).toBe(
      SIDEBAR_DEFAULT_WIDTH,
    );
  });
});
