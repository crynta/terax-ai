const SAMPLE_LIMIT = 600;

export class BoundedResourceTrace<T> {
  private readonly samples: T[] = [];
  private next = 0;

  record(sample: T): void {
    this.samples[this.next] = sample;
    this.next = (this.next + 1) % SAMPLE_LIMIT;
  }

  snapshot(): T[] {
    if (this.samples.length < SAMPLE_LIMIT) return this.samples.slice();
    return this.samples
      .slice(this.next)
      .concat(this.samples.slice(0, this.next));
  }
}
