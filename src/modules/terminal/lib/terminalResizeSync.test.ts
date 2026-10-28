import { describe, expect, it } from "vitest";
import { TerminalResizeSync } from "./terminalResizeSync";

function harness() {
  const log: string[] = [];
  const model = {
    cols: 80,
    rows: 24,
    resize(cols: number, rows: number) {
      this.cols = cols;
      this.rows = rows;
      log.push(`model ${cols}x${rows}`);
    },
  };
  const pty: { cols: number; rows: number }[] = [];
  const sync = new TerminalResizeSync({
    model,
    notify: (cols, rows) => {
      pty.push({ cols, rows });
      log.push(`pty ${cols}x${rows}`);
    },
  });
  return { sync, model, pty, log };
}

describe("TerminalResizeSync", () => {
  it("resizes the model and tells the PTY in one call, model first", () => {
    const { sync, log } = harness();
    expect(sync.request(100, 30)).toBe("applied");
    expect(log).toEqual(["model 100x30", "pty 100x30"]);
  });

  it("does nothing for dimensions the grid already has", () => {
    const { sync, log } = harness();
    expect(sync.request(80, 24)).toBe("unchanged");
    expect(log).toEqual([]);
  });

  it("keeps the model and the PTY identical after every request", () => {
    const { sync, model, pty } = harness();
    for (const [cols, rows] of [
      [90, 24],
      [90, 24],
      [70, 40],
      [70, 41],
    ] as const) {
      sync.request(cols, rows);
      expect(pty[pty.length - 1]).toEqual({ cols: model.cols, rows: model.rows });
    }
    // The repeated size was not delivered twice.
    expect(pty).toHaveLength(3);
  });
});
