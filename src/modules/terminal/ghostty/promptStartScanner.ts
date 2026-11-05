const ESC = 0x1b;
const BEL = 0x07;
const BACKSLASH = 0x5c;
// ESC ] 1 3 3 ; A
const HEADER = [ESC, 0x5d, 0x31, 0x33, 0x33, 0x3b, 0x41];
const MAX_BODY = 512;

/**
 * Finds where each OSC 133;A (prompt start) ends in the byte stream, across
 * chunk boundaries. The terminal reports its events only after a whole chunk
 * is parsed, so cutting the chunk at these offsets is what lets a consumer
 * read the cursor at the point the shell actually started the prompt.
 */
export class PromptStartScanner {
  private matched = 0;
  private body = 0;
  private escaped = false;

  /** Offsets just past each prompt start that ends inside `bytes`. */
  cuts(bytes: Uint8Array): number[] {
    const cuts: number[] = [];
    for (let i = 0; i < bytes.length; i++) {
      if (this.matched === 0) {
        i = bytes.indexOf(ESC, i);
        if (i < 0) break;
        this.matched = 1;
        continue;
      }
      const byte = bytes[i];
      if (this.matched < HEADER.length) {
        this.matched =
          byte === HEADER[this.matched]
            ? this.matched + 1
            : byte === ESC
              ? 1
              : 0;
      } else if (this.escaped) {
        if (byte === BACKSLASH) cuts.push(i + 1);
        this.reset();
        if (byte === ESC) this.matched = 1;
      } else if (byte === BEL) {
        cuts.push(i + 1);
        this.reset();
      } else if (byte === ESC) {
        this.escaped = true;
      } else if (++this.body > MAX_BODY) {
        this.reset();
      }
    }
    return cuts;
  }

  private reset(): void {
    this.matched = 0;
    this.body = 0;
    this.escaped = false;
  }
}
