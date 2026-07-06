/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauriCoreMock = vi.hoisted(() => ({
  invoke: vi.fn(),
}));
const tauriEventMock = vi.hoisted(() => ({
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriCoreMock.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: tauriEventMock.listen,
}));

import { usePushToTalk } from "./usePushToTalk";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Root[] = [];

function HookHarness({ enabled = true }: { enabled?: boolean }) {
  usePushToTalk({
    enabled,
    shortcut: "Alt+Space",
    onStart: () => {},
    onStop: () => {},
  });
  return null;
}

function mount() {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  mounted.push(root);
  return root;
}

function flushEffects() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setTauriBridge() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
}

describe("usePushToTalk", () => {
  beforeEach(() => {
    tauriCoreMock.invoke.mockReset();
    tauriCoreMock.invoke.mockResolvedValue(undefined);
    tauriEventMock.listen.mockReset();
    tauriEventMock.listen.mockResolvedValue(() => {});
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  afterEach(async () => {
    for (const root of mounted.splice(0)) {
      await act(async () => root.unmount());
    }
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("does not call native PTT outside the Tauri bridge", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const root = mount();
    await act(async () => {
      root.render(<HookHarness />);
      await flushEffects();
    });

    expect(tauriCoreMock.invoke).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(tauriEventMock.listen).not.toHaveBeenCalled();
  });

  it("silently disables native PTT when the Tauri command is not registered", async () => {
    setTauriBridge();
    tauriCoreMock.invoke.mockRejectedValueOnce(
      "Command ptt_register not found",
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const root = mount();
    await act(async () => {
      root.render(<HookHarness />);
      await flushEffects();
    });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(tauriEventMock.listen).not.toHaveBeenCalled();
  });
});
