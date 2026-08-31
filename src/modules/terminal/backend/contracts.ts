export type TerminalBackendKind =
  | "xterm-webgl"
  | "ghostty-webgl"
  | "ghostty-webgpu";

export type TerminalRowRange = {
  readonly start: number;
  readonly end: number;
};

export type TerminalDamage =
  | { readonly kind: "none" }
  | { readonly kind: "full" }
  | {
      readonly kind: "rows";
      readonly ranges: readonly TerminalRowRange[];
    };

export type TerminalCursor = {
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
  readonly blinking: boolean;
  readonly style: "block" | "underline" | "bar";
};

export type TerminalModes = {
  readonly alternateScreen: boolean;
  readonly bracketedPaste: boolean;
  readonly focusReporting: boolean;
  readonly mouseTracking: boolean;
  readonly synchronizedOutput: boolean;
};

export type PackedTerminalViewport = {
  /** The bytes are borrowed and must be consumed before the next model call. */
  readonly bytes: Uint8Array;
  readonly cellCount: number;
  readonly cellStride: number;
  readonly cols: number;
  readonly rows: number;
};

export type TerminalModelDiagnostics = {
  readonly backend: TerminalBackendKind;
  readonly cols: number;
  readonly rows: number;
  readonly scrollbackLines: number;
  readonly disposed: boolean;
  /** Raw PTY chunks parsed by this model. */
  readonly writes?: number;
  /** libghostty render-state synchronizations, coalesced to presentation. */
  readonly renderStateUpdates?: number;
};

export interface TerminalModel {
  readonly backend: TerminalBackendKind;
  readonly cols: number;
  readonly rows: number;

  write(bytes: Uint8Array): void;
  resize(cols: number, rows: number): void;
  consumeDamage(): TerminalDamage;
  viewport(): PackedTerminalViewport;
  cursor(): TerminalCursor;
  modes(): TerminalModes;
  readText(maxLines: number): string;
  subscribeDamage(listener: () => void): () => void;
  diagnostics(): TerminalModelDiagnostics;
  dispose(): void;
}

export interface TerminalSurface {
  readonly backend: TerminalBackendKind;

  attach(container: HTMLElement): void;
  detach(): void;
  focus(): void;
  setFocused(focused: boolean): void;
  setVisible(visible: boolean): void;
  getSelection(): string | null;
  dispose(): void;
}
