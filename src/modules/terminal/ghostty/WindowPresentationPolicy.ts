export const PRESENTATION_RECLAIM_DELAY_MS = 2_000;

export type WindowPresentation = {
  readonly visible: boolean;
  readonly reclaim: boolean;
};

const ACTIVE: WindowPresentation = { visible: true, reclaim: false };
const PAUSED: WindowPresentation = { visible: false, reclaim: false };
const RECLAIMED: WindowPresentation = { visible: false, reclaim: true };

export class WindowPresentationPolicy {
  private value = ACTIVE;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hiddenAt: number | null = null;
  transitions = 0;
  reclamations = 0;

  constructor(private readonly publish: (state: WindowPresentation) => void) {}

  snapshot(): WindowPresentation {
    return this.value;
  }

  update(visible: boolean, sleeping = false): void {
    if (visible && !sleeping) {
      this.cancelTimer();
      this.hiddenAt = null;
      this.set(ACTIVE);
      return;
    }
    this.hiddenAt ??= Date.now();
    if (
      sleeping ||
      Date.now() - this.hiddenAt >= PRESENTATION_RECLAIM_DELAY_MS
    ) {
      this.cancelTimer();
      this.set(RECLAIMED);
      return;
    }
    if (this.value.reclaim) return;
    this.set(PAUSED);
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.set(RECLAIMED);
    }, PRESENTATION_RECLAIM_DELAY_MS);
  }

  dispose(): void {
    this.cancelTimer();
  }

  private set(value: WindowPresentation): void {
    if (this.value === value) return;
    this.value = value;
    this.transitions += 1;
    if (value.reclaim) this.reclamations += 1;
    this.publish(value);
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
