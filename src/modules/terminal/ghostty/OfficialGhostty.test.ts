import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { TeraxGhostty } from "@terax/ghostty-core/adapted";
import {
  GhosttyOptimizeMode,
  GhosttyRenderStateDirty,
  OFFICIAL_GHOSTTY_COMMIT,
  OFFICIAL_GHOSTTY_WASM_SHA256,
  OfficialGhostty,
} from "@terax/ghostty-core/official";
import { beforeAll, describe, expect, it } from "vitest";

let ghostty: OfficialGhostty;
let adaptedGhostty: TeraxGhostty;
let wasmBytes: ArrayBuffer;

beforeAll(async () => {
  const path = new URL(
    "../../../../packages/ghostty-core/official/ghostty-vt.wasm",
    import.meta.url,
  );
  const file = await readFile(path);
  wasmBytes = Uint8Array.from(file).buffer;
  ghostty = await OfficialGhostty.loadBytes(wasmBytes.slice(0));
  const adaptedPath = new URL(
    "../../../../packages/ghostty-core/adapted/ghostty-vt.wasm",
    import.meta.url,
  );
  const adaptedFile = await readFile(adaptedPath);
  adaptedGhostty = await TeraxGhostty.loadBytes(
    Uint8Array.from(adaptedFile).buffer,
  );
});

describe("official libghostty-vt integration", () => {
  it("pins the audited upstream artifact", () => {
    expect(OFFICIAL_GHOSTTY_COMMIT).toBe(
      "cecf81678e47f967b0354acada67e69d229f436b",
    );
    expect(
      createHash("sha256").update(Buffer.from(wasmBytes)).digest("hex"),
    ).toBe(OFFICIAL_GHOSTTY_WASM_SHA256);
    expect(ghostty.buildInfo).toMatchObject({
      optimize: GhosttyOptimizeMode.ReleaseFast,
      version: "0.1.0-dev",
    });
  });

  it("routes terminal query replies through one typed WASM callback", () => {
    const replies: Uint8Array[] = [];
    const terminal = ghostty.createTerminal(80, 24, {
      onReply: (bytes) => replies.push(bytes),
    });
    try {
      terminal.write(new TextEncoder().encode("\x1b[c\x1b[5n\x1b[>c\x1b[6n"));
      expect(new TextDecoder().decode(concat(replies))).toBe(
        "\x1b[?62;22c\x1b[0n\x1b[>1;0;0c\x1b[1;1R",
      );
    } finally {
      terminal.dispose();
    }
  });

  it("exposes official bulk raw rows without per-cell WASM calls", () => {
    const terminal = ghostty.createTerminal(12, 4, {
      foreground: [205, 214, 244],
      background: [17, 17, 27],
      cursor: [249, 226, 175],
    });
    try {
      terminal.write(new TextEncoder().encode("plain \x1b[31mred\x1b[0m"));
      expect(terminal.updateRenderState()).toBe(GhosttyRenderStateDirty.Full);

      const rows: Uint32Array[] = [];
      terminal.forEachRawRow(({ cells }) => rows.push(cells.slice()));
      expect(rows).toHaveLength(4);
      expect(rows[0]).toHaveLength(12 * 2);

      expect(rawCellCodepoint(rows[0], 0)).toBe("p".codePointAt(0));
      expect(rawCellCodepoint(rows[0], 6)).toBe("r".codePointAt(0));
      expect(rawCellStyleId(rows[0], 0)).toBe(0);
      expect(rawCellStyleId(rows[0], 6)).toBeGreaterThan(0);

      expect(terminal.colors()).toMatchObject({
        foreground: [205, 214, 244],
        background: [17, 17, 27],
        cursor: [249, 226, 175],
      });
    } finally {
      terminal.dispose();
    }
  });

  it("preserves dirty rows until the renderer commits a frame", () => {
    const terminal = ghostty.createTerminal(20, 4);
    try {
      terminal.write(new TextEncoder().encode("first frame"));
      expect(terminal.updateRenderState()).toBe(GhosttyRenderStateDirty.Full);
      terminal.markRenderStateClean();
      expect(terminal.updateRenderState()).toBe(GhosttyRenderStateDirty.None);

      terminal.write(new TextEncoder().encode("\r\nsecond frame"));
      expect(terminal.updateRenderState()).toBe(
        GhosttyRenderStateDirty.Partial,
      );
      const dirtyRows: number[] = [];
      terminal.forEachRawRow((row) => {
        if (row.dirty) dirtyRows.push(row.row);
      });
      expect(dirtyRows).toEqual([0, 1]);
    } finally {
      terminal.dispose();
    }
  });

  it("matches the adapted core across chunked writes and resize reflow", () => {
    const official = ghostty.createTerminal(17, 5, {
      scrollbackMaxLines: 128,
      scrollbackMaxBytes: 1024 * 1024,
    });
    const adapted = adaptedGhostty.createTerminal(17, 5, {
      maxScrollbackLines: 128,
      maxScrollbackBytes: 1024 * 1024,
    });
    const fixture = new TextEncoder().encode(
      "alpha λ 日本語🙂\r\n" +
        "\x1b[31mred\x1b[0m and plain\r\n" +
        "cursor\x1b[2DXY\r\n" +
        "erase-me\x1b[4D\x1b[Kdone\r\n" +
        Array.from({ length: 12 }, (_, index) => `line-${index}\r\n`).join(""),
    );

    try {
      for (const byte of fixture) {
        const chunk = Uint8Array.of(byte);
        official.write(chunk);
        adapted.write(chunk);
      }
      expectEquivalentViewport(official, adapted);

      for (const [cols, rows] of [
        [23, 6],
        [11, 7],
        [17, 5],
      ] as const) {
        official.resize(cols, rows);
        adapted.resize(cols, rows);
        expectEquivalentViewport(official, adapted);
      }
    } finally {
      official.dispose();
      adapted.dispose();
    }
  });

  it("reuses the shared WASM allocator across terminal lifecycles", () => {
    runLifecycleCycle();
    const warmBytes = ghostty.getMemoryBytes();
    runLifecycleCycle();
    const secondBytes = ghostty.getMemoryBytes();
    runLifecycleCycle();
    const thirdBytes = ghostty.getMemoryBytes();

    expect(secondBytes - warmBytes).toBeLessThanOrEqual(64 * 1024);
    expect(thirdBytes - secondBytes).toBeLessThanOrEqual(64 * 1024);
  });
});

function runLifecycleCycle(): void {
  const terminals = Array.from({ length: 6 }, () =>
    ghostty.createTerminal(100, 32, {
      scrollbackMaxLines: 512,
      scrollbackMaxBytes: 8 * 1024 * 1024,
    }),
  );
  try {
    for (const [index, terminal] of terminals.entries()) {
      const output = Array.from(
        { length: 160 },
        (_, line) => `${index}:${line} λ 日本語 emoji🙂 agent output\r\n`,
      ).join("");
      terminal.write(new TextEncoder().encode(output));
      terminal.updateRenderState();
      let rowCount = 0;
      terminal.forEachRawRow(() => {
        rowCount += 1;
      });
      expect(rowCount).toBe(32);
    }
  } finally {
    for (const terminal of terminals) terminal.dispose();
  }
}

function rawCellCodepoint(row: Uint32Array, column: number): number {
  return (row[column * 2] >>> 2) & 0x1f_ffff;
}

function rawCellStyleId(row: Uint32Array, column: number): number {
  const low = row[column * 2];
  const high = row[column * 2 + 1];
  return (low >>> 26) | ((high & 0x3ff) << 6);
}

function expectEquivalentViewport(
  official: ReturnType<OfficialGhostty["createTerminal"]>,
  adapted: ReturnType<TeraxGhostty["createTerminal"]>,
): void {
  official.updateRenderState();
  const officialRows: number[][] = [];
  official.forEachRawRow(({ cells }) => {
    const codepoints = new Array<number>(official.cols);
    for (let column = 0; column < official.cols; column += 1) {
      codepoints[column] = rawCellCodepoint(cells, column);
    }
    officialRows.push(codepoints);
  });
  const adaptedState = adapted.updateRenderState();
  const adaptedRows = Array.from({ length: adapted.rows }, (_, row) =>
    Array.from(
      adaptedState.codepoints.subarray(
        row * adapted.cols,
        (row + 1) * adapted.cols,
      ),
    ),
  );

  expect(officialRows).toEqual(adaptedRows);
  expect(official.scrollbackRows()).toBe(
    Math.max(0, adapted.scrollbar().total - adapted.scrollbar().length),
  );
  const officialCursor = official.cursor();
  expect(officialCursor).toMatchObject({
    x: adaptedState.cursor.column,
    y: adaptedState.cursor.row,
    visible: adaptedState.cursor.visible,
    blinking: adaptedState.cursor.blinking,
  });
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
