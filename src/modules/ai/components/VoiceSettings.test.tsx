/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEYRING_SERVICE } from "@/modules/ai/config";

const tauriCoreMock = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriCoreMock.invoke,
}));

import { VoiceSettings } from "./VoiceSettings";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Root[] = [];

function mount() {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  mounted.push(root);
  return { element, root };
}

function flushEffects() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("VoiceSettings", () => {
  beforeEach(() => {
    tauriCoreMock.invoke.mockReset();
    tauriCoreMock.invoke.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    for (const root of mounted.splice(0)) {
      await act(async () => root.unmount());
    }
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("saves voice API keys to the shared keyring service", async () => {
    const { element, root } = mount();

    await act(async () => {
      root.render(<VoiceSettings />);
      await flushEffects();
    });

    const input = element.querySelector<HTMLInputElement>(
      'input[placeholder="Cartesia API Key"]',
    );
    expect(input).not.toBeNull();
    const save = Array.from(element.querySelectorAll("button")).find(
      (button) => button.textContent === "Save",
    );
    expect(save).toBeDefined();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "  cartesia-secret  ");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      await flushEffects();
    });
    await act(async () => {
      save!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushEffects();
    });

    expect(tauriCoreMock.invoke).toHaveBeenCalledWith("secrets_set", {
      service: KEYRING_SERVICE,
      account: "cartesia-api-key",
      password: "cartesia-secret",
    });
  });
});
