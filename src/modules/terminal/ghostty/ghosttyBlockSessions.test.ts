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
  const layout = { origin: 0, history: 0, rows: 24, cols: 80, cursor: 0 };
  const model = {
    enableSemanticMarkers: markers,
    semanticMarkerLine: () => null,
    semanticMarkerColumn: () => null,
    readTextRange: () => "",
    readCellLine: () => [],
    bufferCursorLine: () => layout.cursor,
    viewportOriginLine: () => layout.origin,
    scrollPosition: () => ({ offset: 0, history: layout.history }),
    get rows() {
      return layout.rows;
    },
    get cols() {
      return layout.cols;
    },
    modes: () => ({ alternateScreen: false }),
    subscribeDamage: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  } as unknown as GhosttyTerminalModelApi;
  return { model, markers, listeners, layout };
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

describe("block chrome recomputation", () => {
  async function presented() {
    const env = fakeModel();
    const state = new GhosttyBlockSession();
    state.cellHeight = () => 19;
    const chrome = vi.fn();
    const content = vi.fn();
    state.subscribeViewport(chrome);
    state.subscribeContent(content);
    await state.attach(env.model, () => {});
    state.setVisible(true);
    state.present();
    chrome.mockClear();
    content.mockClear();
    return { ...env, state, chrome, content };
  }

  it("does not recompute block chrome for frames that move nothing", async () => {
    const { state, chrome, content } = await presented();
    for (let frame = 0; frame < 50; frame++) {
      state.changed();
      state.present();
    }
    expect(chrome).not.toHaveBeenCalled();
    // Screen-content subscribers (the watermark) still see every dirty frame.
    expect(content).toHaveBeenCalledTimes(50);
  });

  it.each([
    ["scrolling", { origin: 1 }],
    ["scrollback growth", { history: 1 }],
    ["a row resize", { rows: 30 }],
    ["a column resize (reflow)", { cols: 120 }],
  ])("recomputes block chrome after %s", async (_name, patch) => {
    const { state, chrome, layout } = await presented();
    Object.assign(layout, patch);
    state.changed();
    state.present();
    expect(chrome).toHaveBeenCalledTimes(1);
    state.changed();
    state.present();
    expect(chrome).toHaveBeenCalledTimes(1);
  });

  it("recomputes when the cell height changes (zoom or font)", async () => {
    const { state, chrome } = await presented();
    state.cellHeight = () => 22;
    state.changed();
    state.present();
    expect(chrome).toHaveBeenCalledTimes(1);
  });

  it("recomputes when the block set changes", async () => {
    const { state, chrome } = await presented();
    state.controller?.handle(
      { type: "end-of-command", marker: null, exitCode: 0 } as never,
      "/",
    );
    state.changed();
    state.present();
    expect(chrome).toHaveBeenCalledTimes(1);
  });

  it("resends the layout to a late subscriber and after presentation resumes", async () => {
    const { state, chrome } = await presented();
    const late = vi.fn();
    state.subscribeViewport(late);
    state.present();
    expect(late).toHaveBeenCalledTimes(1);

    for (const listener of presentation.listeners)
      listener({ visible: false, reclaim: false });
    for (const listener of presentation.listeners)
      listener({ visible: true, reclaim: false });
    chrome.mockClear();
    state.present();
    expect(chrome).toHaveBeenCalledTimes(1);
  });

  it("runs the mode effect once per mode change, not per damage", async () => {
    const { state, listeners } = await presented();
    const effect = vi.fn();
    state.modeEffect = effect;
    for (let i = 0; i < 20; i++) for (const listener of listeners) listener();
    expect(effect).not.toHaveBeenCalled();

    // Prompt integration flips the controller from "plain" to "prompt".
    state.controller?.handle(
      { type: "prompt-end", blockInput: true } as never,
      "/",
    );
    state.changed();
    expect(effect).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) state.changed();
    expect(effect).toHaveBeenCalledTimes(1);
  });
});
