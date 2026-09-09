import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Key, KeyAction, Mods } from "@terax/ghostty-core";
import {
  ADAPTED_GHOSTTY_COMMIT,
  ADAPTED_GHOSTTY_WASM_SHA256,
  ADAPTED_GHOSTTY_SCALAR_WASM_SHA256,
  ADAPTED_RESTTY_COMMIT,
  TeraxGhostty,
} from "@terax/ghostty-core/adapted";
import { beforeAll, describe, expect, it } from "vitest";

describe.each([
  ["SIMD", "ghostty-vt.wasm", ADAPTED_GHOSTTY_WASM_SHA256],
  ["scalar", "ghostty-vt-scalar.wasm", ADAPTED_GHOSTTY_SCALAR_WASM_SHA256],
])("%s Ghostty core", (_kind, artifact, checksum) => {
  let ghostty: TeraxGhostty;
  let wasmBytes: ArrayBuffer;

  beforeAll(async () => {
    const path = new URL(
      `../../../../packages/ghostty-core/adapted/${artifact}`,
      import.meta.url,
    );
    const file = await readFile(path);
    wasmBytes = Uint8Array.from(file).buffer;
    ghostty = await TeraxGhostty.loadBytes(wasmBytes.slice(0));
  });

  describe("Terax Ghostty WASM adaptation", () => {
    it("reports when a shell requires direct terminal input", () => {
      const terminal = ghostty.createTerminal(16, 4);
      try {
        terminal.write(
          new TextEncoder().encode(
            "\x1b]133;B;terax_blocks=0\x07\x1b]133;B\x07",
          ),
        );
        expect(terminal.drainEvents()).toEqual([
          { type: "prompt-end", blockInput: false },
          { type: "prompt-end" },
        ]);
      } finally {
        terminal.dispose();
      }
    });

    it("tracks exact command boundaries through batching, reflow and reset", () => {
      const terminal = ghostty.createTerminal(16, 4);
      try {
        terminal.enableSemanticMarkers(true);
        terminal.write(
          new TextEncoder().encode(
            "\x1b]133;C;printf alpha\x07abcdefghijklmnopQRST\r\n\x1b]133;D;255\x07\x1b]133;C;second\x07second\r\n\x1b]133;D;1000\x07",
          ),
        );
        const events = terminal.drainEvents();
        const first = events[0];
        const end = events[1];
        expect(first).toMatchObject({
          type: "end-of-input",
          command: "printf alpha",
        });
        expect(end).toMatchObject({ type: "end-of-command", exitCode: 255 });
        expect(events[3]).toMatchObject({ exitCode: 1000 });
        if (
          first.type !== "end-of-input" ||
          end.type !== "end-of-command" ||
          !first.marker ||
          !end.marker
        )
          throw new Error("Missing command events");
        expect(terminal.semanticMarkerLine(first.marker)).toBe(0);
        expect(terminal.semanticMarkerLine(end.marker)).toBe(2);
        terminal.resize(8, 4);
        expect(terminal.semanticMarkerLine(end.marker)).toBe(3);
        expect(terminal.readTextRange(0, 2)).toBe("abcdefghijklmnopQRST");
        terminal.write(new TextEncoder().encode("\x1bc"));
        expect(terminal.semanticMarkerLine(first.marker)).toBeNull();
      } finally {
        terminal.dispose();
      }
    });

    it("invalidates clear markers at parse time without allocating events for plain terminals", () => {
      const terminal = ghostty.createTerminal(16, 4);
      const write = (text: string) =>
        terminal.write(new TextEncoder().encode(text));
      try {
        write("\x1b[2J\x1b[3J\x1bc");
        expect(terminal.drainEvents()).toEqual([]);
        terminal.enableSemanticMarkers(true);
        for (let index = 0; index < 256; index++) {
          write("\x1b]133;C;old\x07\x1b[2J\x1b]133;C;new\x07");
          const [before, clear, after] = terminal.drainEvents();
          expect(clear).toEqual({ type: "screen-cleared" });
          if (
            before.type !== "end-of-input" ||
            !before.marker ||
            after.type !== "end-of-input" ||
            !after.marker
          )
            throw new Error("Missing markers");
          expect(terminal.semanticMarkerLine(before.marker)).toBeNull();
          expect(terminal.semanticMarkerLine(after.marker)).toBe(0);
          expect(terminal.semanticMarkerCount()).toBe(1);
        }
      } finally {
        terminal.dispose();
      }
    });

    it("bounds semantic pins and releases them when blocks are disabled", () => {
      const terminal = ghostty.createTerminal(16, 4, {
        maxScrollbackLines: 10,
      });
      try {
        terminal.write(new TextEncoder().encode("\x1b]133;C;x\x07"));
        expect(terminal.semanticMarkerCount()).toBe(0);
        terminal.enableSemanticMarkers(true);
        terminal.write(new TextEncoder().encode("\x1b]133;C;x\x07"));
        const first = terminal.drainEvents().slice(-1)[0];
        if (first.type !== "end-of-input" || !first.marker)
          throw new Error("Missing marker");
        terminal.write(new TextEncoder().encode("line\r\n".repeat(10_000)));
        expect(terminal.semanticMarkerLine(first.marker)).toBeNull();
        terminal.write(
          new TextEncoder().encode("\x1b]133;C;x\x07".repeat(3000)),
        );
        expect(terminal.semanticMarkerCount()).toBe(2048);
        terminal.enableSemanticMarkers(false);
        expect(terminal.semanticMarkerCount()).toBe(0);
        terminal.enableSemanticMarkers(true);
        terminal.write(new TextEncoder().encode("\x1b]133;C;new\x07"));
        const last = terminal.drainEvents().slice(-1)[0];
        if (last.type !== "end-of-input" || !last.marker)
          throw new Error("Missing marker");
        expect(terminal.semanticMarkerLine(last.marker)).not.toBeNull();
        expect(terminal.semanticMarkerLine(first.marker)).toBeNull();
      } finally {
        terminal.dispose();
      }
    });
    it("pins the audited Ghostty and Restty sources", () => {
      expect(ADAPTED_GHOSTTY_COMMIT).toBe(
        "f426f6f181ba95f45d33f683fb754b6359d9e04f",
      );
      expect(ADAPTED_RESTTY_COMMIT).toBe(
        "7700b14a7643ba9240818209ef1e0aa90d83ad77",
      );
      expect(
        createHash("sha256").update(Buffer.from(wasmBytes)).digest("hex"),
      ).toBe(checksum);
    });

    it("parses raw bytes into rich colors, styles, graphemes, and links", () => {
      const terminal = ghostty.createTerminal(32, 4);
      try {
        terminal.setDefaultColors(0xcdd6f4, 0x11111b, 0xf9e2af);
        const palette = new Uint8Array(16 * 3);
        palette.set([1, 2, 3], 3);
        terminal.setPalette(palette);

        const uri = "https://terax.dev/docs";
        terminal.write(
          new TextEncoder().encode(
            `\x1b[31mR\x1b[0m\x1b[1mB\x1b[0m e\u0301 \x1b]8;;${uri}\x1b\\L\x1b]8;;\x1b\\`,
          ),
        );
        const state = terminal.updateRenderState();

        expect([...state.foregroundRgba.subarray(0, 4)]).toEqual([
          1, 2, 3, 255,
        ]);
        expect(state.styleFlags[1]).not.toBe(0);
        expect(terminal.graphemeAt(state, 3)).toBe("é");
        expect(terminal.hyperlinkAt(state, 5)).toBe(uri);
        expect(state.cursor.column).toBe(6);
      } finally {
        terminal.dispose();
      }
    });

    it("releases and lazily rebuilds presentation state without losing terminal data", () => {
      const terminal = ghostty.createTerminal(80, 24);
      try {
        terminal.write(new TextEncoder().encode("persistent agent output"));
        const before = terminal.updateRenderState();
        expect(before.codepoints[0]).toBe("p".codePointAt(0));
        const initialStats = terminal.resourceStats();

        terminal.releaseRenderState();

        expect(terminal.resourceStats()).toMatchObject({
          cellCapacity: 0,
          rowCapacity: 0,
          renderStateResets: initialStats.renderStateResets + 1,
        });
        const rebuilt = terminal.updateRenderState();
        expect(rebuilt.codepoints[0]).toBe("p".codePointAt(0));
      } finally {
        terminal.dispose();
      }
    });

    it("allocates presentation only on demand and restores links and graphemes after release", () => {
      const terminal = ghostty.createTerminal(120, 40);
      try {
        terminal.write(
          new TextEncoder().encode(
            "\x1b]8;;https://example.test\x07e\u0301\x1b]8;;\x07",
          ),
        );
        terminal.resize(121, 41);
        expect(terminal.resourceStats().cellCapacity).toBe(0);
        const first = terminal.updateRenderState();
        expect(terminal.graphemeAt(first, 0)).toBe("e\u0301");
        expect(terminal.hyperlinkAt(first, 0)).toBe("https://example.test");
        terminal.releaseRenderState();
        expect(terminal.resourceStats().cellCapacity).toBe(0);
        terminal.write(new TextEncoder().encode("next"));
        expect(terminal.resourceStats().cellCapacity).toBe(0);
        const restored = terminal.updateRenderState();
        expect(terminal.graphemeAt(restored, 0)).toBe("e\u0301");
        expect(terminal.hyperlinkAt(restored, 0)).toBe("https://example.test");
        expect(restored.fullDamage).toBe(true);
      } finally {
        terminal.dispose();
      }
    });

    it("preserves extended underline styles, colors, overline, and inverse", () => {
      const terminal = ghostty.createTerminal(8, 2);
      try {
        terminal.write(
          new TextEncoder().encode(
            "\x1b[4:2;58:2::10:20:30;53mX" +
              "\x1b[0;38;2;1;2;3;48;2;4;5;6;7;4mY",
          ),
        );
        const state = terminal.updateRenderState();

        expect(state.underlineStyles[0]).toBe(2);
        expect([...state.underlineRgba.subarray(0, 4)]).toEqual([
          10, 20, 30, 255,
        ]);
        expect(state.styleFlags[0] & (1 << 7)).not.toBe(0);
        expect(state.underlineStyles[1]).toBe(1);
        expect([...state.underlineRgba.subarray(4, 8)]).toEqual([4, 5, 6, 255]);
      } finally {
        terminal.dispose();
      }
    });

    it("returns shell capability replies as ordered raw bytes", () => {
      const terminal = ghostty.createTerminal(80, 24);
      try {
        terminal.write(new TextEncoder().encode("\x1b[c\x1b[5n\x1b[>c\x1b[6n"));
        expect(new TextDecoder().decode(terminal.drainOutputBytes())).toBe(
          "\x1b[?62;22;52c\x1b[0n\x1b[>1;10;0c\x1b[1;1R",
        );
        expect(terminal.drainOutputBytes()).toHaveLength(0);
      } finally {
        terminal.dispose();
      }
    });

    it("answers native mode, pixel-size, visibility, version, and color queries", () => {
      const terminal = ghostty.createTerminal(80, 24);
      try {
        terminal.setPixelSize(720, 432);
        terminal.setDefaultColors(0xcdd6f4, 0x11111b, 0xf9e2af);
        terminal.write(
          new TextEncoder().encode(
            "\x1b[?2004$p" +
              "\x1b[14t\x1b[16t\x1b[18t" +
              "\x1b[>q" +
              "\x1b[?996n\x1b[?998n" +
              "\x1b]10;?\x07\x1b]11;?\x07\x1b]12;?\x07",
          ),
        );

        expect(new TextDecoder().decode(terminal.drainOutputBytes())).toBe(
          "\x1b[?2004;2$y" +
            "\x1b[4;432;720t\x1b[6;18;9t\x1b[8;24;80t" +
            "\x1bP>|ghostty 1.3.2-dev\x1b\\" +
            "\x1b[?997;1n\x1b[?999;1n" +
            "\x1b]10;rgb:cdcd/d6d6/f4f4\x07" +
            "\x1b]11;rgb:1111/1111/1b1b\x07" +
            "\x1b]12;rgb:f9f9/e2e2/afaf\x07",
        );
      } finally {
        terminal.dispose();
      }
    });

    it("answers upstream Ghostty XTGETTCAP and DECRQSS queries", () => {
      const terminal = ghostty.createTerminal(80, 24);
      try {
        terminal.write(
          new TextEncoder().encode(
            "\x1bP+q544E;524742\x1b\\" + "\x1bP$qm\x1b\\",
          ),
        );
        expect(new TextDecoder().decode(terminal.drainOutputBytes())).toBe(
          "\x1bP1+r544E=787465726D2D67686F73747479\x1b\\" +
            "\x1bP1+r524742=38\x1b\\" +
            "\x1bP1$r0m\x1b\\",
        );
      } finally {
        terminal.dispose();
      }
    });

    it("emits parser-owned semantic events in stream order", () => {
      const terminal = ghostty.createTerminal(80, 24);
      try {
        terminal.write(
          new TextEncoder().encode(
            "\x1b]2;Terax title\x07" +
              "\x1b]7;file://localhost/Users/terax\x1b\\" +
              "\x1b]133;A\x07" +
              "\x1b]133;B\x07" +
              "\x1b]133;C\x07" +
              "\x1b]133;D;7\x07" +
              "\x1b]52;c;aGVsbG8=\x07" +
              "\x07",
          ),
        );

        expect(terminal.drainEvents()).toEqual([
          { type: "title", title: "Terax title" },
          { type: "pwd", uri: "file://localhost/Users/terax" },
          { type: "prompt-start" },
          { type: "prompt-end" },
          { type: "end-of-input" },
          { type: "end-of-command", exitCode: 7 },
          { type: "clipboard", selection: "c", data: "aGVsbG8=" },
          { type: "bell" },
        ]);
        expect(terminal.drainEvents()).toEqual([]);
      } finally {
        terminal.dispose();
      }
    });

    it("encodes Ctrl+C as an interrupt in normal and alternate screens", () => {
      const terminal = ghostty.createTerminal(8, 3);
      try {
        for (const sequence of ["", "\x1b[?1049h", "\x1b[?1049l"]) {
          terminal.write(new TextEncoder().encode(sequence));
          expect(
            terminal.encodeKey({
              action: KeyAction.PRESS,
              key: Key.C,
              mods: Mods.CTRL,
              utf8: "c",
            }),
          ).toEqual(new Uint8Array([3]));
        }
      } finally {
        terminal.dispose();
      }
    });

    it("uses current Ghostty state for key encoding and terminal modes", () => {
      const terminal = ghostty.createTerminal(8, 3);
      try {
        expect(
          new TextDecoder().decode(
            terminal.encodeKey({
              action: KeyAction.PRESS,
              key: Key.UP,
              mods: Mods.NONE,
            }),
          ),
        ).toBe("\x1b[A");

        terminal.write(
          new TextEncoder().encode(
            "\x1b[?1h\x1b[?2004h\x1b[?1004h\x1b[?1002h\x1b[?1049h",
          ),
        );
        expect(
          new TextDecoder().decode(
            terminal.encodeKey({
              action: KeyAction.PRESS,
              key: Key.UP,
              mods: Mods.NONE,
            }),
          ),
        ).toBe("\x1bOA");
        expect(terminal.modes()).toEqual({
          alternateScreen: true,
          bracketedPaste: true,
          focusReporting: true,
          mouseTracking: true,
          synchronizedOutput: false,
        });
        expect(terminal.mode(1002)).toBe(true);

        terminal.write(new TextEncoder().encode("\x1b[?2026h"));
        expect(terminal.modes().synchronizedOutput).toBe(true);
        terminal.write(new TextEncoder().encode("\x1b[?2026l"));
        expect(terminal.modes().synchronizedOutput).toBe(false);
      } finally {
        terminal.dispose();
      }
    });

    it("exports viewport wrapping and absolute scroll state", () => {
      const terminal = ghostty.createTerminal(4, 2, {
        maxScrollbackBytes: 1024 * 1024,
        maxScrollbackLines: 100,
      });
      try {
        terminal.write(new TextEncoder().encode("abcdefgh\r\nijkl\r\nmnop"));
        const live = terminal.updateRenderState();
        expect(live.rowWrapped[0]).toBe(0);
        expect(terminal.scrollbar().total).toBeGreaterThan(2);

        terminal.scrollViewportTo(0);
        expect(terminal.scrollbar().offset).toBe(0);
        const top = terminal.updateRenderState();
        expect(top.rowWrapped[1]).toBe(1);
      } finally {
        terminal.dispose();
      }
    });

    it("keeps tracked selections stable while output streams", () => {
      const terminal = ghostty.createTerminal(12, 3, {
        maxScrollbackBytes: 1024 * 1024,
        maxScrollbackLines: 100,
      });
      try {
        terminal.write(
          new TextEncoder().encode("first line\r\nsecond line\r\nthird line"),
        );
        terminal.setSelection({
          anchor: { line: 0, column: 0 },
          focus: { line: 1, column: 5 },
          rectangular: false,
        });

        expect(terminal.selectionText()).toBe("first line\nsecond");
        terminal.write(new TextEncoder().encode("\r\nfourth\r\nfifth"));

        expect(terminal.selection()).toEqual({
          anchor: { line: 0, column: 0 },
          focus: { line: 1, column: 5 },
          rectangular: false,
        });
        expect(terminal.selectionText()).toBe("first line\nsecond");

        terminal.write(new TextEncoder().encode("\x1b[?1049h"));
        expect(terminal.selection()).toBeNull();
      } finally {
        terminal.dispose();
      }
    });

    it("keeps tracked selections attached to content through reflow", () => {
      const terminal = ghostty.createTerminal(12, 3, {
        maxScrollbackBytes: 1024 * 1024,
        maxScrollbackLines: 100,
      });
      try {
        terminal.write(new TextEncoder().encode("abcdefghijklmnopqrstuvwx"));
        terminal.setSelection({
          anchor: { line: 0, column: 2 },
          focus: { line: 1, column: 5 },
          rectangular: false,
        });
        const selected = terminal.selectionText();

        terminal.resize(8, 4);

        expect(terminal.selection()).not.toBeNull();
        expect(terminal.selectionText()).toBe(selected);
      } finally {
        terminal.dispose();
      }
    });

    it("searches scrollback incrementally and exports viewport spans", () => {
      const terminal = ghostty.createTerminal(16, 3, {
        maxScrollbackBytes: 1024 * 1024,
        maxScrollbackLines: 100,
      });
      try {
        terminal.write(
          new TextEncoder().encode(
            "alpha one\r\nsecond\r\nalpha three\r\nfourth",
          ),
        );
        let status = terminal.setSearchQuery("alpha");
        for (let step = 0; step < 100 && !status.complete; step += 1) {
          status = terminal.stepSearch(32);
        }

        expect(status.complete).toBe(true);
        expect(status.totalMatches).toBe(2);
        status = terminal.selectSearchMatch("next");
        expect(status.selectedIndex).toBeGreaterThanOrEqual(0);
        expect(terminal.searchViewportMatches()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              startColumn: 0,
              endColumn: 5,
            }),
          ]),
        );

        terminal.clearSearch();
        expect(terminal.searchStatus().active).toBe(false);
        expect(terminal.searchViewportMatches()).toEqual([]);
      } finally {
        terminal.dispose();
      }
    });

    it("rejects oversized search queries before growing shared WASM memory", () => {
      const terminal = ghostty.createTerminal(16, 3);
      try {
        const before = ghostty.getMemoryBytes();
        expect(() => terminal.setSearchQuery("x".repeat(4_097))).toThrow(
          "exceeds 4096 UTF-8 bytes",
        );
        expect(ghostty.getMemoryBytes()).toBe(before);
      } finally {
        terminal.dispose();
      }
    });

    it("reuses typed views until WASM memory or dimensions change", () => {
      const terminal = ghostty.createTerminal(20, 4);
      try {
        terminal.write(new TextEncoder().encode("first"));
        const first = terminal.updateRenderState();
        const second = terminal.updateRenderState();
        expect(second.codepoints).toBe(first.codepoints);
        expect(second.foregroundRgba).toBe(first.foregroundRgba);

        terminal.resize(30, 5);
        const resized = terminal.updateRenderState();
        expect(resized.codepoints).not.toBe(first.codepoints);
        expect(resized.cellCount).toBe(150);
      } finally {
        terminal.dispose();
      }
    });

    it("computes stable row-level damage inside WASM", () => {
      const terminal = ghostty.createTerminal(20, 4);
      try {
        const initial = terminal.updateRenderState();
        expect(initial.fullDamage).toBe(true);
        expect([...initial.dirtyRows]).toEqual([1, 1, 1, 1]);

        const unchanged = terminal.updateRenderState();
        expect(unchanged.fullDamage).toBe(false);
        expect([...unchanged.dirtyRows]).toEqual([0, 0, 0, 0]);

        terminal.write(new TextEncoder().encode("\x1b[3;1Hagent"));
        const changed = terminal.updateRenderState();
        expect(changed.fullDamage).toBe(false);
        expect([...changed.dirtyRows]).toEqual([1, 0, 1, 0]);

        terminal.write(new TextEncoder().encode("\x1b]2;title only\x07"));
        const semanticOnly = terminal.updateRenderState();
        expect([...semanticOnly.dirtyRows]).toEqual([0, 0, 0, 0]);
      } finally {
        terminal.dispose();
      }
    });

    it("keeps bridge rows coherent when the viewport scrolls", () => {
      const terminal = ghostty.createTerminal(8, 3);
      try {
        terminal.write(new TextEncoder().encode("one\r\ntwo\r\nthree"));
        expect(asciiRows(terminal.updateRenderState())).toEqual([
          "one",
          "two",
          "three",
        ]);

        terminal.write(new TextEncoder().encode("\r\nfour"));
        const scrolled = terminal.updateRenderState();
        expect(asciiRows(scrolled)).toEqual(["two", "three", "four"]);
        expect([...scrolled.dirtyRows]).toEqual([1, 1, 1]);
      } finally {
        terminal.dispose();
      }
    });

    it("keeps clean-row grapheme and hyperlink storage valid across partial frames", () => {
      const terminal = ghostty.createTerminal(24, 4);
      const uri = "https://terax.dev/agent";
      try {
        terminal.write(
          new TextEncoder().encode(
            `e\u0301 \x1b]8;;${uri}\x1b\\L\x1b]8;;\x1b\\`,
          ),
        );
        const initial = terminal.updateRenderState();
        expect(terminal.graphemeAt(initial, 0)).toBe("é");
        expect(terminal.hyperlinkAt(initial, 2)).toBe(uri);

        terminal.write(new TextEncoder().encode("\x1b[3;1Hstream"));
        const partial = terminal.updateRenderState();
        expect(partial.fullDamage).toBe(false);
        expect(partial.dirtyRows[2]).toBe(1);
        expect(terminal.graphemeAt(partial, 0)).toBe("é");
        expect(terminal.hyperlinkAt(partial, 2)).toBe(uri);
      } finally {
        terminal.dispose();
      }
    });

    it("interns persistent hyperlinks across dirty-row updates and storage growth", () => {
      const terminal = ghostty.createTerminal(40, 4);
      const encoder = new TextEncoder();
      const uri = "https://terax.dev/persistent";
      try {
        terminal.write(
          encoder.encode(`\x1b]8;;${uri}\x1b\\link\x1b]8;;\x1b\\`),
        );
        terminal.updateRenderState();
        for (let index = 0; index < 5_000; index += 1) {
          terminal.write(encoder.encode(`\x1b[1;10H${index % 10}`));
          const state = terminal.updateRenderState();
          expect(state.fullDamage).toBe(false);
          expect(state.linkOffsets.length).toBe(1);
          expect(state.linkBytes.length).toBe(uri.length);
          expect(terminal.hyperlinkAt(state, 0)).toBe(uri);
        }
        for (let index = 0; index < 100; index += 1) {
          const other = `https://terax.dev/${index}/${"path/".repeat(index)}`;
          terminal.write(
            encoder.encode(`\x1b[3;1H\x1b]8;;${other}\x1b\\new\x1b]8;;\x1b\\`),
          );
          const state = terminal.updateRenderState();
          expect(terminal.hyperlinkAt(state, 80)).toBe(other);
          expect(terminal.hyperlinkAt(state, 0)).toBe(uri);
        }
        terminal.write(encoder.encode("\x1b[1;10HX"));
        const grown = terminal.updateRenderState();
        expect(grown.linkOffsets.length).toBeLessThanOrEqual(101);
        expect(terminal.hyperlinkAt(grown, 0)).toBe(uri);
        terminal.releaseRenderState();
        const rebuilt = terminal.updateRenderState();
        expect(rebuilt.linkOffsets.length).toBe(2);
        expect(terminal.hyperlinkAt(rebuilt, 0)).toBe(uri);
      } finally {
        terminal.dispose();
      }
    });

    it("reuses shared WASM memory across multi-tab lifecycle cycles", () => {
      runLifecycleCycle();
      const warmBytes = ghostty.getMemoryBytes();
      runLifecycleCycle();
      const secondBytes = ghostty.getMemoryBytes();
      runLifecycleCycle();
      const thirdBytes = ghostty.getMemoryBytes();

      expect(secondBytes - warmBytes).toBeLessThanOrEqual(64 * 1024);
      expect(thirdBytes - secondBytes).toBeLessThanOrEqual(64 * 1024);
    });

    it("keeps five fresh terminals within the shared WASM page budget", async () => {
      const isolated = await TeraxGhostty.loadBytes(wasmBytes.slice(0));
      const baseline = isolated.getMemoryBytes();
      const terminals = Array.from({ length: 5 }, () =>
        isolated.createTerminal(80, 24, {
          maxScrollbackBytes: 8 * 1024 * 1024,
          maxScrollbackLines: 1_000,
        }),
      );
      try {
        expect(isolated.getMemoryBytes() - baseline).toBeLessThanOrEqual(
          4 * 1024 * 1024,
        );
      } finally {
        for (const terminal of terminals) terminal.dispose();
      }
    });

    it("stabilizes render-buffer memory across adjacent resize cycles", async () => {
      const isolated = await TeraxGhostty.loadBytes(wasmBytes.slice(0));
      const terminal = isolated.createTerminal(80, 24);
      const sizes = [
        [120, 40],
        [121, 40],
        [119, 41],
        [122, 39],
        [120, 40],
      ] as const;
      try {
        for (const [cols, rows] of sizes) {
          terminal.resize(cols, rows);
          terminal.updateRenderState();
        }
        const warmBytes = isolated.getMemoryBytes();
        for (let cycle = 0; cycle < 20; cycle += 1) {
          for (const [cols, rows] of sizes) {
            terminal.resize(cols, rows);
            terminal.updateRenderState();
          }
        }
        expect(isolated.getMemoryBytes() - warmBytes).toBeLessThanOrEqual(
          64 * 1024,
        );
      } finally {
        terminal.dispose();
      }
    });

    it("compacts oversized bridge buffers after a resize gesture", () => {
      const terminal = ghostty.createTerminal(80, 24);
      try {
        terminal.resize(300, 100);
        terminal.updateRenderState();
        const peak = terminal.resourceStats();

        terminal.resize(80, 24);
        terminal.updateRenderState();
        expect(terminal.resourceStats().cellCapacity).toBe(peak.cellCapacity);

        terminal.compactRenderState();
        const compacted = terminal.resourceStats();
        expect(compacted.cellCapacity).toBeLessThan(peak.cellCapacity);
        expect(compacted.rowCapacity).toBeLessThan(peak.rowCapacity);
        expect(terminal.updateRenderState().fullDamage).toBe(true);
      } finally {
        terminal.dispose();
      }
    });

    it("reuses WASM allocations across repeated presentation release cycles", async () => {
      const isolated = await TeraxGhostty.loadBytes(wasmBytes.slice(0));
      const terminal = isolated.createTerminal(120, 40);
      try {
        terminal.write(
          new TextEncoder().encode("agent frame with λ 日本語 🙂\r\n"),
        );
        for (let cycle = 0; cycle < 4; cycle += 1) {
          terminal.updateRenderState();
          terminal.releaseRenderState();
        }
        const warmBytes = isolated.getMemoryBytes();
        for (let cycle = 0; cycle < 100; cycle += 1) {
          terminal.write(new TextEncoder().encode(`frame ${cycle}\r`));
          terminal.updateRenderState();
          terminal.releaseRenderState();
        }

        expect(isolated.getMemoryBytes() - warmBytes).toBeLessThanOrEqual(
          64 * 1024,
        );
      } finally {
        terminal.dispose();
      }
    });

    it("bounds linear-memory growth for three agent-sized scrollbacks", async () => {
      const isolated = await TeraxGhostty.loadBytes(wasmBytes.slice(0));
      const baseline = isolated.getMemoryBytes();
      const terminals = Array.from({ length: 3 }, () =>
        isolated.createTerminal(120, 40, {
          maxScrollbackBytes: 8 * 1024 * 1024,
          maxScrollbackLines: 10_000,
        }),
      );
      try {
        for (const [index, terminal] of terminals.entries()) {
          const output = Array.from(
            { length: 5_000 },
            (_, line) =>
              `${index}:${line} Codex streaming output λ 日本語 🙂\r\n`,
          ).join("");
          terminal.write(new TextEncoder().encode(output));
          terminal.updateRenderState();
        }
        const growth = isolated.getMemoryBytes() - baseline;
        expect(growth).toBeLessThan(20 * 1024 * 1024);
      } finally {
        for (const terminal of terminals) terminal.dispose();
      }
    });
  });

  function runLifecycleCycle(): void {
    const terminals = Array.from({ length: 6 }, () =>
      ghostty.createTerminal(100, 32, {
        maxScrollbackBytes: 4 * 1024 * 1024,
        maxScrollbackLines: 512,
      }),
    );
    try {
      for (const [index, terminal] of terminals.entries()) {
        const output = Array.from(
          { length: 160 },
          (_, line) => `${index}:${line} λ 日本語 emoji🙂 agent output\r\n`,
        ).join("");
        terminal.write(new TextEncoder().encode(output));
        const state = terminal.updateRenderState();
        expect(state.cellCount).toBe(3_200);
      }
    } finally {
      for (const terminal of terminals) terminal.dispose();
    }
  }

  function asciiRows(state: {
    readonly rows: number;
    readonly cols: number;
    readonly codepoints: Uint32Array;
  }): string[] {
    return Array.from({ length: state.rows }, (_, row) => {
      let text = "";
      for (let column = 0; column < state.cols; column += 1) {
        const codepoint = state.codepoints[row * state.cols + column];
        text += codepoint === 0 ? " " : String.fromCodePoint(codepoint);
      }
      return text.trimEnd();
    });
  }
});
