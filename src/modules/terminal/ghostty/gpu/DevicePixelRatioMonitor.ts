export class DevicePixelRatioMonitor {
  private query: MediaQueryList | null = null;

  constructor(private readonly onChange: () => void) {}

  start(): void {
    this.stop();
    if (typeof window.matchMedia !== "function") return;
    this.query = window.matchMedia(
      `(resolution: ${Math.max(1, window.devicePixelRatio || 1)}dppx)`,
    );
    this.query.addEventListener("change", this.handleChange, { once: true });
  }

  stop(): void {
    this.query?.removeEventListener("change", this.handleChange);
    this.query = null;
  }

  private readonly handleChange = (): void => {
    this.start();
    this.onChange();
  };
}
