const DEFAULT_MAX = 500;

export class HistoryRing {
  private readonly lines: string[] = [];
  private readonly max: number;

  constructor(max = DEFAULT_MAX) {
    this.max = max;
  }

  push(line: string): void {
    const t = line.trim();
    if (t.length === 0) return;
    const last = this.lines[this.lines.length - 1];
    if (last === t) return;
    this.lines.push(t);
    while (this.lines.length > this.max) this.lines.shift();
  }

  /** Longest-prefix matches, most recent first. */
  matchPrefix(prefix: string, cap: number): string[] {
    if (prefix.length === 0) return [];
    const lower = prefix.toLowerCase();
    const out: string[] = [];
    for (let i = this.lines.length - 1; i >= 0 && out.length < cap; i--) {
      const line = this.lines[i];
      if (line.toLowerCase().startsWith(lower) && line.length > prefix.length) {
        if (!out.includes(line)) out.push(line);
      }
    }
    return out;
  }
}
