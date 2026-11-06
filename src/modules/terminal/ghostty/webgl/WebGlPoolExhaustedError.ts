/** More visible panes than WebGL contexts; the pane shows its error and retry state. */
export class WebGlPoolExhaustedError extends Error {
  constructor(readonly limit: number) {
    super(
      `Too many visible WebGL terminals (${limit}). Close a pane and retry, or choose WebGPU in Settings for new terminals.`,
    );
    this.name = "WebGlPoolExhaustedError";
  }
}
