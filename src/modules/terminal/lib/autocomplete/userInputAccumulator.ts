/**
 * Tracks printable user input from xterm onData (PTY echo does not pass onData).
 * Handles backspace/delete and bracketed paste; clears on Enter.
 */
export class UserInputAccumulator {
  private acc = "";

  get(): string {
    return this.acc;
  }

  clear(): void {
    this.acc = "";
  }

  /** Replace buffer (e.g. after accepting a completion). */
  set(value: string): void {
    this.acc = value;
  }

  /** Apply a user-initiated data chunk. */
  applyUserData(data: string): { submitted: boolean; submittedLine?: string } {
    let submitted = false;
    let submittedLine: string | undefined;
    let i = 0;
    while (i < data.length) {
      const c = data[i];
      if (c === "\r" || c === "\n") {
        submitted = true;
        submittedLine = this.acc.trim();
        this.acc = "";
        i += 1;
        continue;
      }
      if (c === "\x1b") {
        const rest = data.slice(i);
        const bp = rest.match(/^\x1b\[200~([\s\S]*?)\x1b\[201~/);
        if (bp) {
          for (const ch of bp[1]) {
            if (ch >= " " && ch !== "\x7f") this.acc += ch;
          }
          i += bp[0].length;
          continue;
        }
        const m = rest.match(/^\x1b(?:\[[0-9;?]*[A-Za-z]|\][0-9:;]*\x07|\][^\x07\x1b]*\x1b\\)/);
        if (m) {
          i += m[0].length;
          continue;
        }
        i += 1;
        continue;
      }
      if (c === "\x7f" || c === "\b") {
        this.acc = this.acc.slice(0, -1);
        i += 1;
        continue;
      }
      if (c === "\t") {
        i += 1;
        continue;
      }
      if (c >= " " && c !== "\x7f") {
        this.acc += c;
      }
      i += 1;
    }
    return { submitted, submittedLine };
  }
}
