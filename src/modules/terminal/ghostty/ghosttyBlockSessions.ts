import { subscribeWindowPresentation } from "@/modules/terminal/ghostty/windowPresentation";
import type { GhosttyTerminalModelApi } from "@/modules/terminal/ghostty/GhosttyTerminalModel";
import type { GhosttyBlocks } from "@/modules/terminal/ghostty/GhosttyBlocks";
import type { BlockMode } from "@/modules/terminal/block/lib/modeMachine";

export type WatermarkState = "visible" | "hidden" | "dead";

export class GhosttyBlockSession {
  controller: GhosttyBlocks | null = null;
  model: GhosttyTerminalModelApi | null = null;
  focus: (() => void) | null = null;
  paste: ((text: string) => void) | null = null;
  keyDown: ((event: KeyboardEvent) => boolean) | null = null;
  draft = "";
  inputActive = false;
  everSubmitted = false;
  private generation = 0;
  private mode: BlockMode = "plain";
  private visible = false;
  private presented = false;
  private unsubscribePresentation: (() => void) | null = null;
  private dirty = true;
  private requestFrame: (() => void) | null = null;
  private unsubscribeDamage: (() => void) | null = null;
  private readonly viewportListeners = new Set<() => void>();
  private readonly modeListeners = new Set<() => void>();

  async attach(
    model: GhosttyTerminalModelApi,
    requestFrame: () => void = () => {},
  ): Promise<void> {
    this.detach();
    const generation = this.generation;
    const { GhosttyBlocks } = await import(
      "@/modules/terminal/ghostty/GhosttyBlocks"
    );
    if (generation !== this.generation || model.isDisposed?.()) return;
    this.model = model;
    this.requestFrame = requestFrame;
    this.controller = new GhosttyBlocks(model);
    this.unsubscribeDamage = model.subscribeDamage(() => this.changed());
    this.unsubscribePresentation = subscribeWindowPresentation((state) => {
      this.presented = state.visible;
      if (state.visible) this.changed();
      else this.invalidateViewport();
    });
    this.changed();
  }

  detach(): void {
    this.generation++;
    this.unsubscribePresentation?.();
    this.unsubscribePresentation = null;
    this.unsubscribeDamage?.();
    this.unsubscribeDamage = null;
    this.controller?.dispose();
    this.controller = null;
    this.model = null;
    this.requestFrame = null;
    this.invalidateViewport();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) this.changed();
    else this.invalidateViewport();
  }

  changed(): void {
    const mode = this.controller?.mode ?? "plain";
    if (mode !== this.mode) {
      this.mode = mode;
      for (const listener of this.modeListeners) listener();
    }
    this.dirty = true;
    if (this.visible && this.presented) this.requestFrame?.();
  }

  present(): void {
    if (!this.dirty || !this.visible || !this.presented) return;
    this.dirty = false;
    for (const listener of this.viewportListeners) listener();
  }

  readonly getMode = (): BlockMode => this.mode;
  readonly subscribeMode = (listener: () => void): (() => void) => {
    this.modeListeners.add(listener);
    return () => {
      this.modeListeners.delete(listener);
    };
  };
  readonly subscribeViewport = (listener: () => void): (() => void) => {
    this.viewportListeners.add(listener);
    this.changed();
    return () => {
      this.viewportListeners.delete(listener);
    };
  };

  watermark(): WatermarkState {
    if (this.everSubmitted || this.controller?.hasAnyBlock) return "dead";
    if (!this.model || this.inputActive) return "hidden";
    if (
      this.model.scrollPosition().history > 0 ||
      this.model.readText(this.model.rows).trim()
    )
      return "dead";
    return "visible";
  }

  dispose(): void {
    this.detach();
    this.focus = null;
    this.paste = null;
    this.keyDown = null;
    this.draft = "";
    this.modeListeners.clear();
    this.viewportListeners.clear();
  }

  private invalidateViewport(): void {
    this.dirty = true;
  }
}

const states = new Map<number, GhosttyBlockSession>();
export function ensureGhosttyBlocks(leafId: number): GhosttyBlockSession {
  let state = states.get(leafId);
  if (!state) {
    state = new GhosttyBlockSession();
    states.set(leafId, state);
  }
  return state;
}
export function ghosttyBlocks(leafId: number): GhosttyBlockSession | undefined {
  return states.get(leafId);
}
export function disposeGhosttyBlocks(leafId: number): void {
  states.get(leafId)?.dispose();
  states.delete(leafId);
}

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    for (const state of states.values()) state.dispose();
    states.clear();
  });
