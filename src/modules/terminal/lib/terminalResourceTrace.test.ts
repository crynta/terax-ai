import { afterEach, expect, it, vi } from "vitest";
import { recordTerminalResources } from "@/modules/terminal/lib/terminalDiagnostics";

const bridge = vi.hoisted(() => ({ listeners: new Set<() => void>() }));
vi.mock("@/modules/terminal/ghostty/windowPresentation", () => ({
  windowPresentationDiagnostics: () => ({ visible: true }),
  subscribeWindowPresentation: (callback: () => void) => {
    bridge.listeners.add(callback);
    callback();
    return () => bridge.listeners.delete(callback);
  },
}));
vi.mock("@/modules/terminal/ghostty/GhosttyCoreRuntime", () => ({
  ghosttyCoreRuntimeDiagnostics: () => ({ wasmMemoryBytes: 0 }),
}));
vi.mock("@/modules/terminal/ghostty/gpu/WebGpuTerminalRuntime", () => ({
  webGpuTerminalRuntimeDiagnostics: () => null,
}));
vi.mock("@/modules/terminal/ghostty/webgl/WebGlTerminalRuntime", () => ({
  webGlTerminalRuntimeDiagnostics: () => null,
}));
vi.mock("@/modules/terminal/ghostty/useGhosttyTerminalSession", () => ({
  ghosttySessionResourceTotals: () => ({}),
  ghosttySessionDiagnostics: () => [],
}));
vi.mock("@/modules/terminal/lib/pty-bridge", () => ({
  ptyTransportDiagnostics: () => ({}),
}));

afterEach(() => vi.useRealTimers());

it("runs only one explicit recording and automatically releases its timers and subscription", () => {
  vi.useFakeTimers();
  expect(vi.getTimerCount()).toBe(0);
  const first = recordTerminalResources();
  expect(first.snapshot()).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(2);
  const second = recordTerminalResources();
  const stoppedFirst = first.snapshot();
  expect(bridge.listeners.size).toBe(1);
  for (let event = 0; event < 1_000; event++) {
    for (const callback of bridge.listeners) callback();
  }
  vi.advanceTimersByTime(10 * 60_000);
  expect(vi.getTimerCount()).toBe(0);
  expect(bridge.listeners.size).toBe(0);
  expect(second.snapshot()).toHaveLength(600);
  expect(first.snapshot()).toEqual(stoppedFirst);
  expect(second.stop()).toEqual(second.stop());
});
