import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => core);

import {
  EMPTY_PROVIDER_KEYS,
  getAllCustomEndpointKeys,
  getAllKeys,
  getKey,
  getCustomEndpointKey,
  hasAnyKey,
  setCustomEndpointKey,
  setKey,
} from "./keyring";

const secretsArgs = (account: string) => ({
  service: "terax-ai",
  account,
});

describe("provider keyring", () => {
  beforeEach(() => {
    core.invoke.mockReset();
  });

  it("reads a provider key from the OS keychain service", async () => {
    core.invoke.mockResolvedValue("sk-secret");

    await expect(getKey("openai")).resolves.toBe("sk-secret");
    expect(core.invoke).toHaveBeenCalledWith(
      "secrets_get",
      secretsArgs("openai-api-key"),
    );
  });

  it("maps an absent read to null and swallows backend failures", async () => {
    core.invoke.mockResolvedValueOnce(null);
    await expect(getKey("openai")).resolves.toBeNull();

    core.invoke.mockResolvedValueOnce("");
    await expect(getKey("anthropic")).resolves.toBeNull();

    core.invoke.mockRejectedValueOnce(new Error("locked"));
    await expect(getKey("google")).resolves.toBeNull();
  });

  it("refuses to store empty or blank keys", async () => {
    await expect(setKey("groq", "   ")).rejects.toThrow(/empty/);
    expect(core.invoke).not.toHaveBeenCalled();
  });

  it("trims and stores a key under the provider account", async () => {
    await setKey("groq", "  gsk-key  ");

    expect(core.invoke).toHaveBeenCalledWith("secrets_set", {
      service: "terax-ai",
      account: "groq-api-key",
      password: "gsk-key",
    });
  });

  it("batch-reads all keyed providers and maps results by id", async () => {
    core.invoke.mockResolvedValueOnce(["sk-o", null, "", "x"]);
    const keys = await getAllKeys();

    expect(keys.openai).toBe("sk-o");
    expect(keys.anthropic).toBeNull();
    expect(keys.google).toBeNull();
    expect(keys.xai).toBe("x");
    expect(keys.ollama).toBeNull();
    const call = core.invoke.mock.calls[0];
    expect(call[0]).toBe("secrets_get_all");
  });

  it("falls back to per-provider reads when the batch fails", async () => {
    core.invoke
      .mockRejectedValueOnce(new Error("no batch"))
      .mockResolvedValueOnce("found");

    const keys = await getAllKeys();

    expect(keys.openai).toBe("found");
    expect(EMPTY_PROVIDER_KEYS.openrouter).toBeNull();
  });

  it("hasAnyKey is true only when a keyed provider holds a value", () => {
    expect(hasAnyKey({ ...EMPTY_PROVIDER_KEYS })).toBe(false);
    expect(hasAnyKey({ ...EMPTY_PROVIDER_KEYS, ollama: "anything" })).toBe(
      false,
    );
    expect(hasAnyKey({ ...EMPTY_PROVIDER_KEYS, openai: "sk-1" })).toBe(true);
  });

  it("stores custom endpoint keys under compat accounts", async () => {
    await setCustomEndpointKey("e1", " k ");
    expect(core.invoke).toHaveBeenCalledWith("secrets_set", {
      service: "terax-ai",
      account: "compat-e1-api-key",
      password: "k",
    });

    core.invoke.mockResolvedValueOnce("v");
    await expect(getCustomEndpointKey("e1")).resolves.toBe("v");

    await expect(setCustomEndpointKey("e1", " ")).rejects.toThrow(/empty/);
    expect(core.invoke).not.toHaveBeenCalledWith(
      "secrets_set",
      expect.objectContaining({ password: "" }),
    );
  });

  it("maps custom endpoint batch results and tolerates an empty list", async () => {
    await expect(getAllCustomEndpointKeys([])).resolves.toEqual({});
    expect(core.invoke).not.toHaveBeenCalled();

    core.invoke.mockResolvedValueOnce([null, "two"]);
    const keys = await getAllCustomEndpointKeys([
      { id: "a", name: "A", baseURL: "http://a" },
      { id: "b", name: "B", baseURL: "http://b" },
    ] as never);

    expect(keys).toEqual({ a: null, b: "two" });
  });

  it("EMPTY_PROVIDER_KEYS covers every keyed provider in config", async () => {
    const { PROVIDERS, providerSupportsKey } = await import("../config");
    const emptyKeys = Object.keys(EMPTY_PROVIDER_KEYS);
    for (const p of PROVIDERS.filter((p) => providerSupportsKey(p.id))) {
      expect(emptyKeys, `${p.id} missing from EMPTY_PROVIDER_KEYS`).toContain(
        p.id,
      );
    }
    expect(Object.values(EMPTY_PROVIDER_KEYS).every((v) => v === null)).toBe(
      true,
    );
  });
});
