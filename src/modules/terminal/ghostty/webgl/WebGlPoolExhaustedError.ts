/** More visible panes than WebGL contexts; the pane shows its error and retry state. */
export class WebGlPoolExhaustedError extends Error {
  constructor(readonly limit: number) {
    super(`WebGL terminal renderer pool exhausted (${limit} visible panes)`);
    this.name = "WebGlPoolExhaustedError";
  }
}
