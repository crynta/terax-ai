import { beforeEach, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { clearCustomEndpointKey, clearKey } from "./keyring";

beforeEach(() => invoke.mockReset());

it.each([
  ["provider", () => clearKey("openai")],
  ["endpoint", () => clearCustomEndpointKey("custom")],
] as const)(
  "propagates failed %s deletion and accepts native absence",
  async (_, clear) => {
    invoke.mockRejectedValueOnce(new Error("keychain access denied"));
    await expect(clear()).rejects.toThrow("keychain access denied");
    invoke.mockResolvedValueOnce(undefined);
    await expect(clear()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(2);
  },
);
