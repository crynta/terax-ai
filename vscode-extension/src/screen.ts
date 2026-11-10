import { Terminal } from "@xterm/headless";

/**
 * An invisible copy of one VS Code terminal: fed the same raw output, sized
 * like the real one, so the Reader can read Claude's dialogs, footer and
 * activity line exactly as Terax reads them from its own terminal.
 */
export class ScreenMirror {
  private readonly term: Terminal;
  private pending = 0;

  constructor(cols: number, rows: number, scrollback = 2000) {
    this.term = new Terminal({
      cols: clampCols(cols),
      rows: clampRows(rows),
      scrollback,
      allowProposedApi: true,
    });
  }

  write(data: string): void {
    this.pending += 1;
    this.term.write(data, () => {
      this.pending -= 1;
    });
  }

  /** Resolves once every write so far has been parsed. */
  flush(): Promise<void> {
    if (this.pending === 0) return Promise.resolve();
    return new Promise((resolve) => this.term.write("", resolve));
  }

  resize(cols: number, rows: number): void {
    const c = clampCols(cols);
    const r = clampRows(rows);
    if (c !== this.term.cols || r !== this.term.rows) this.term.resize(c, r);
  }

  /** The visible rows, right-trimmed (Terax's `leafScreenText`). */
  screenText(): string {
    return this.tailText(this.term.rows);
  }

  /** The last `lines` lines of the buffer, scrollback included. */
  tailText(lines: number): string {
    const buffer = this.term.buffer.active;
    const total = buffer.length;
    const first = Math.max(0, total - Math.max(0, Math.floor(lines)));
    const out: string[] = [];
    for (let y = first; y < total; y++) {
      out.push(buffer.getLine(y)?.translateToString(true) ?? "");
    }
    return out.join("\n").trimEnd();
  }

  get bracketedPaste(): boolean {
    return this.term.modes.bracketedPasteMode;
  }

  dispose(): void {
    this.term.dispose();
  }
}

function clampCols(n: number): number {
  return Math.min(1000, Math.max(20, Math.floor(n) || 80));
}

function clampRows(n: number): number {
  return Math.min(500, Math.max(5, Math.floor(n) || 24));
}
