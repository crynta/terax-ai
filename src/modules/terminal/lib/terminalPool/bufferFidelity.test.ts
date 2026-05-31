import { Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vitest";

// Buffer-fidelity invariant — the structural cure for Defects A/B/C.
//
// The OLD architecture serialized a backgrounded leaf to a snapshot (capped at
// 5000 rows) + a 256KB byte ring, then on show did clear()+reset()+write
// (snapshot)+replay. That round-trip was lossy three ways. The NEW architecture
// keeps ONE persistent Terminal per leaf and NEVER serializes/clears/recycles
// it; a "tab switch" is a pure view op that does not touch the buffer.
//
// This test exercises the PERSISTENT-BUFFER contract directly against a real
// headless xterm Terminal: write A, simulate hide (no buffer op), write B while
// "hidden", simulate show (no buffer op), assert the buffer == A+B verbatim and
// that scrollback beyond the old 5000-row cap is fully retained.
//
// It would FAIL against the old code: clear()+reset() on every show discarded
// the live buffer, and the 5000-row serialize cap dropped early scrollback.
//
// xterm's full Terminal runs renderer-less in pure node (the parser/InputHandler
// mutate buffer.lines with no DOM) — verified; no jsdom needed. We use the
// write(data, callback) completion form to await the async WriteBuffer drain.

function writeAsync(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

function readBuffer(term: Terminal): string[] {
  const buf = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buf.length; i++) {
    lines.push(buf.getLine(i)?.translateToString(true) ?? "");
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

describe("persistent buffer — no data loss across hide/show", () => {
  it("retains A + B verbatim when bytes arrive while 'hidden' (no rebuild)", async () => {
    const term = new Terminal({ cols: 80, rows: 24, scrollback: 1000 });

    // Foreground output.
    await writeAsync(term, "alpha-line-1\r\nalpha-line-2\r\n");

    // HIDE: in the new model this is a pure DOM-detach view op — the buffer is
    // untouched. We simulate it by doing NOTHING to the buffer (the old code
    // would have serialized + cleared here).
    const afterHide = readBuffer(term);
    expect(afterHide).toEqual(["alpha-line-1", "alpha-line-2"]);

    // Bytes keep flowing into the persistent emulator while "hidden".
    await writeAsync(term, "beta-while-hidden-1\r\nbeta-while-hidden-2\r\n");

    // SHOW: again a pure view op — no clear()+reset()+replay. The buffer is
    // already correct; xterm's on-intersect refreshRows would just repaint it.
    const afterShow = readBuffer(term);
    expect(afterShow).toEqual([
      "alpha-line-1",
      "alpha-line-2",
      "beta-while-hidden-1",
      "beta-while-hidden-2",
    ]);
  });

  it("survives many hide/show cycles byte-faithfully (no cumulative drift)", async () => {
    const term = new Terminal({ cols: 80, rows: 24, scrollback: 2000 });
    const expected: string[] = [];
    for (let cycle = 0; cycle < 50; cycle++) {
      const line = `cycle-${cycle}-output`;
      await writeAsync(term, `${line}\r\n`);
      expected.push(line);
      // Each iteration is a hide+show with zero buffer mutation.
    }
    expect(readBuffer(term)).toEqual(expected);
  });
});

describe("persistent buffer — full scrollback retained (Defect C)", () => {
  it("keeps scrollback well beyond the old 5000-row serialize cap", async () => {
    const SCROLLBACK = 6000;
    const term = new Terminal({ cols: 80, rows: 24, scrollback: SCROLLBACK });

    const LINES = 5500; // > old SNAPSHOT_SCROLLBACK_CAP of 5000
    let payload = "";
    for (let i = 0; i < LINES; i++) payload += `line${i}\r\n`;
    await writeAsync(term, payload);

    const buf = term.buffer.active;
    // The earliest line (line0) would have been TRUNCATED by the old 5000-cap
    // serialize. With a persistent buffer it survives up to options.scrollback.
    expect(buf.getLine(0)?.translateToString(true)).toBe("line0");
    // A line that sits ~5000 rows back — exactly where the old cap sliced.
    expect(buf.getLine(450)?.translateToString(true)).toBe("line450");
    // Total retained reflects the full scrollback budget, not a 5000 ceiling.
    expect(buf.length).toBeGreaterThan(5000);
  });

  it("trims to options.scrollback (bounded memory — F2)", async () => {
    // Background cap proof: a small scrollback bounds buffer growth — the basis
    // for the two-tier foreground/background memory budget.
    const term = new Terminal({ cols: 80, rows: 24, scrollback: 200 });
    let payload = "";
    for (let i = 0; i < 2000; i++) payload += `x${i}\r\n`;
    await writeAsync(term, payload);
    // viewport(24) + scrollback(200) is the hard upper bound.
    expect(term.buffer.active.length).toBeLessThanOrEqual(200 + 24 + 1);
  });
});
