import { afterEach, describe, expect, it, vi } from "vitest";
import type { GhosttyTerminalModelApi } from "./GhosttyTerminalModel";
import { GhosttyBlockSession } from "./ghosttyBlockSessions";

const presentation = vi.hoisted(() => ({
  listeners: new Set<(state: { visible: boolean; reclaim: boolean }) => void>(),
}));
vi.mock("@/modules/terminal/ghostty/windowPresentation", () => ({
  subscribeWindowPresentation: (
    listener: (state: { visible: boolean; reclaim: boolean }) => void,
  ) => {
    presentation.listeners.add(listener);
    listener({ visible: true, reclaim: false });
    return () => {
      presentation.listeners.delete(listener);
    };
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  presentation.listeners.clear();
});

function fakeModel() {
  const listeners = new Set<() => void>();
  const markers = vi.fn();
  const model = {
    enableSemanticMarkers: markers,
    semanticMarkerLine: () => null,
    semanticMarkerColumn: () => null,
    readTextRange: () => "",
    readCellLine: () => [],
    bufferCursorLine: () => 0,
    modes: () => ({ alternateScreen: false }),
    subscribeDamage: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } as unknown as GhosttyTerminalModelApi;
  return { model, markers, listeners };
}

describe("block presentation ownership", () => {
  it("coalesces damage, stops when hidden or occluded, and releases listeners", async () => {
    const { model, markers, listeners } = fakeModel();
    const state = new GhosttyBlockSession();
    const update = vi.fn();
    const requestFrame = vi.fn();
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    state.subscribeViewport(update);
    await state.attach(model, requestFrame);
    expect(requestFrame).not.toHaveBeenCalled();
    state.setVisible(true);
    for (let i = 0; i < 100; i++) for (const listener of listeners) listener();
    expect(update).not.toHaveBeenCalled();
    state.present();
    state.present();
    expect(update).toHaveBeenCalledOnce();
    expect(raf).not.toHaveBeenCalled();
    for (const listener of presentation.listeners)
      listener({ visible: false, reclaim: false });
    requestFrame.mockClear();
    state.changed();
    state.present();
    expect(requestFrame).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
    for (const listener of presentation.listeners)
      listener({ visible: true, reclaim: false });
    expect(requestFrame).toHaveBeenCalledOnce();
    state.present();
    expect(update).toHaveBeenCalledTimes(2);
    state.setVisible(false);
    state.changed();
    state.present();
    expect(update).toHaveBeenCalledTimes(2);
    state.dispose();
    expect(markers).toHaveBeenLastCalledWith(false);
    expect(listeners.size).toBe(0);
    expect(presentation.listeners.size).toBe(0);
  });

  it("cannot attach block resources after a session closes during lazy loading", async () => {
    const { model, markers } = fakeModel();
    const state = new GhosttyBlockSession();
    const pending = state.attach(model);
    state.dispose();
    await pending;
    expect(markers).not.toHaveBeenCalled();
    expect(state.controller).toBeNull();
    expect(presentation.listeners.size).toBe(0);
  });
});
