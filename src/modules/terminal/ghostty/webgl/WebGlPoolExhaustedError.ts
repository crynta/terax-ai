/** More visible panes than WebGL contexts; the pane shows its error and retry state. */
export class WebGlPoolExhaustedError extends Error {
  constructor(readonly limit: number) {
    super(
      `Too many visible WebGL terminals (${limit}). Close a pane or switch the renderer to WebGPU in Settings.`,
    );
    this.name = "WebGlPoolExhaustedError";
  }
}
