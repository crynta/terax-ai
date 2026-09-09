import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TeraxGhostty } from "@terax/ghostty-core/adapted";
import { AdaptedGhosttyTerminalModel } from "@/modules/terminal/ghostty/AdaptedGhosttyTerminalModel";
import {
  GhosttyBlocks,
  matchCellText,
} from "@/modules/terminal/ghostty/GhosttyBlocks";

describe.each(["ghostty-vt", "ghostty-vt-scalar"])(
  "Ghostty command blocks (%s)",
  (artifact) => {
    let core: TeraxGhostty;
    beforeAll(async () => {
      const bytes = await readFile(
        new URL(
          `../../../../packages/ghostty-core/adapted/${artifact}.wasm`,
          import.meta.url,
        ),
      );
      core = await TeraxGhostty.loadBytes(Uint8Array.from(bytes).buffer);
    });

    function create() {
      let blocks: GhosttyBlocks;
      const model = new AdaptedGhosttyTerminalModel(core, {
        backend: "ghostty-webgpu",
        cols: 20,
        rows: 6,
        onEvent: (event) => blocks.handle(event, "/workspace"),
      });
      blocks = new GhosttyBlocks(model);
      return {
        model,
        blocks,
        write: (text: string) => model.write(new TextEncoder().encode(text)),
        dispose: () => {
          blocks.dispose();
          model.dispose();
        },
      };
    }

    it("yields during large block searches and cancels without scanning the remaining history", async () => {
      const { model, blocks, write, dispose } = create();
      vi.useFakeTimers();
      try {
        write(
          `\x1b]133;C;long\x07${"line\r\n".repeat(1000)}target\x1b]133;D;0\x07`,
        );
        const read = vi.spyOn(model, "readCellLine");
        const cancel = new AbortController();
        const stopped = blocks.searchBlock("1", "target", cancel.signal);
        expect(read.mock.calls.length).toBeLessThanOrEqual(128);
        cancel.abort();
        expect(await stopped).toEqual([]);
        expect(read.mock.calls.length).toBeLessThanOrEqual(128);
        expect(vi.getTimerCount()).toBe(0);
        const complete = blocks.searchBlock("1", "target");
        await vi.runAllTimersAsync();
        expect(await complete).toEqual([{ line: 1000, col: 0, len: 6 }]);
      } finally {
        vi.useRealTimers();
        dispose();
      }
    });

    it("retains commands, status and output for multiple commands in one parse", () => {
      const { model, blocks, write, dispose } = create();
      try {
        write(
          "\x1b]133;C;first\x07one\r\n\x1b]133;D;1000\x07\x1b]133;C;second\x07two\r\n\x1b]133;D;0\x07",
        );
        expect(blocks.mode).toBe("prompt");
        expect(blocks.readById("1")).toEqual({
          command: "first",
          cwd: "/workspace",
          exitCode: 1000,
          output: "one",
        });
        expect(blocks.readById("2")?.output).toBe("two");
        expect(blocks.visibleBlocks(20).blocks).toHaveLength(2);
        expect(blocks.navigate(-1)).toBe(true);
        expect(model.trackedSelection()).not.toBeNull();
        expect(blocks.clearSelection()).toBe(true);
      } finally {
        dispose();
      }
    });

    it("leaves a blank row before the divider without including padding in copied output", () => {
      const { model, blocks, write, dispose } = create();
      try {
        write("\x1b]133;C;echo\x07output\r\n\x1b]133;D;0\x07\r\n\r\n");
        expect(blocks.visibleBlocks(20).blocks[0].bottom).toBe(40);
        expect(blocks.readById("1")?.output).toBe("output");
        write("\r\n".repeat(8));
        model.scrollTo(model.scrollPosition().history - 1);
        expect(model.viewportOriginLine()).toBe(1);
        expect(blocks.visibleBlocks(20).blocks[0].bottom).toBe(20);
      } finally {
        dispose();
      }
    });

    it("keeps direct input until shell integration confirms a shared prompt", () => {
      const { blocks, write, dispose } = create();
      try {
        expect(blocks.mode).toBe("plain");
        write("bare shell> \x1b]133;A\x07");
        expect(blocks.mode).toBe("plain");
        write("\x1b]133;B;terax_blocks=0\x07");
        expect(blocks.mode).toBe("plain");
        write("\x1b]133;C;command\x07\x1b]133;D;0\x07");
        expect(blocks.mode).toBe("plain");
        write("\x1b]133;B\x07");
        expect(blocks.mode).toBe("prompt");
      } finally {
        dispose();
      }
    });

    it("keeps selections and viewport intact while reading and searching blocks", async () => {
      const { model, blocks, write, dispose } = create();
      try {
        write(
          "\x1b]133;C;echo\x07wide 日本語 output\r\nsecond\r\n\x1b]133;D;0\x07",
        );
        model.setSelection({
          anchor: { line: 1, column: 0 },
          focus: { line: 1, column: 5 },
          rectangular: false,
        });
        const selection = model.trackedSelection();
        const origin = model.viewportOriginLine();
        expect(blocks.readById("1")?.output).toContain("日本語");
        const matches = await blocks.searchBlock("1", "日本語");
        expect(matches[0]).toEqual({ line: 0, col: 5, len: 6 });
        expect(model.trackedSelection()).toEqual(selection);
        expect(model.viewportOriginLine()).toBe(origin);
        blocks.revealMatch(matches[0]);
        expect(model.searchViewportMatches()).toContainEqual({
          row: 0,
          startColumn: 5,
          endColumn: 11,
          selected: true,
        });
        blocks.clearSearch();
        expect(model.searchViewportMatches()).toEqual([]);
      } finally {
        dispose();
      }
    });

    it("hides block chrome in alternate screen and preserves it on return", () => {
      const { blocks, write, dispose } = create();
      try {
        blocks.submitted("vim");
        write("\x1b]133;C\x07\x1b[?1049h\x1b[2J\x1b[3JTUI");
        expect(blocks.mode).toBe("alt");
        expect(blocks.visibleBlocks(20).blocks).toHaveLength(0);
        write("\x1b[?1049l\x1b]133;D;0\x07");
        expect(blocks.mode).toBe("prompt");
        expect(blocks.readById("1")?.command).toBe("vim");
      } finally {
        dispose();
      }
    });

    it("selects and searches exact inline command boundaries", async () => {
      const { model, blocks, write, dispose } = create();
      try {
        write("prompt \x1b]133;C;echo\x07output\x1b]133;D;0\x07 next");
        expect(blocks.selectAtLine(0)).toBe(true);
        const selection = model.trackedSelection();
        expect(selection).toEqual({
          anchor: { line: 0, column: 7 },
          focus: { line: 0, column: 12 },
          rectangular: false,
        });
        if (!selection) throw new Error("Missing command selection");
        expect(model.selectionText(selection)).toBe("output");
        expect(await blocks.searchBlock("1", "next")).toEqual([]);
        blocks.revealMatch({ line: 0, col: 7, len: 6 });
        model.resize(10, 6);
        expect(model.blockSearchActive()).toBe(false);
        expect(blocks.readById("1")?.output).toBe("output");
      } finally {
        dispose();
      }
    });

    it("clears stale block identities after a terminal reset", () => {
      const { blocks, write, dispose } = create();
      try {
        write("\x1b]133;C;old\x07output\r\n\x1b]133;D;0\x07\x1bc");
        expect(blocks.readById("1")).toBeNull();
        expect(blocks.diagnostics()).toEqual({ blocks: 0, metadataBytes: 0 });
        expect(blocks.visibleBlocks(20).blocks).toHaveLength(0);
      } finally {
        dispose();
      }
    });

    it.each(["\x1b[H\x1b[2J", "\x1b[3J", "\x1b[H\x1b[2J\x1b[3J", "\x1bc"])(
      "clears block metadata, selection and search for fragmented %j",
      (sequence) => {
        const { model, blocks, write, dispose } = create();
        try {
          write("\x1b]133;C;echo\x07output\r\n\x1b]133;D;0\x07");
          expect(blocks.selectAtLine(0)).toBe(true);
          blocks.revealMatch({ line: 0, col: 0, len: 6 });
          const generation = blocks.visibleBlocks(20).generation;
          for (const byte of sequence) write(byte);
          expect(blocks.diagnostics()).toEqual({ blocks: 0, metadataBytes: 0 });
          expect(blocks.visibleBlocks(20).blocks).toEqual([]);
          expect(blocks.visibleBlocks(20).generation).toBeGreaterThan(
            generation,
          );
          expect(model.trackedSelection()).toBeNull();
          expect(model.blockSearchActive()).toBe(false);
        } finally {
          dispose();
        }
      },
    );

    it("preserves commands parsed after a clear in the same output chunk", () => {
      const { blocks, write, dispose } = create();
      try {
        write(
          "\x1b]133;C;old\x07old\r\n\x1b]133;D;0\x07" +
            "\x1b[H\x1b[2J\x1b[3J" +
            "\x1b]133;C;new\x07new\r\n\x1b]133;D;0\x07",
        );
        expect(blocks.diagnostics().blocks).toBe(1);
        expect(blocks.readById("1")).toBeNull();
        expect(blocks.readById("2")?.output).toBe("new");
        expect(blocks.visibleBlocks(20).blocks).toHaveLength(1);
      } finally {
        dispose();
      }
    });

    it("does not treat labels or partial/selective erases as a clear", () => {
      const { blocks, write, dispose } = create();
      try {
        write("\x1b]133;C;clear\x07output\r\n\x1b]133;D;0\x07");
        write("\x1b[J\x1b[?2J");
        expect(blocks.diagnostics().blocks).toBe(1);
        expect(blocks.visibleBlocks(20).generation).toBe(0);
      } finally {
        dispose();
      }
    });

    it("retains bounded block metadata across repeated clears", () => {
      const { blocks, write, dispose } = create();
      try {
        for (let index = 0; index < 256; index++) {
          write(
            "\x1b[H\x1b[2J\x1b[3J\x1b]133;C;echo\x07ok\r\n\x1b]133;D;0\x07",
          );
          expect(blocks.diagnostics().blocks).toBe(1);
          expect(blocks.readById(String(index + 1))?.output).toBe("ok");
        }
        expect(blocks.diagnostics().metadataBytes).toBeLessThan(64);
      } finally {
        dispose();
      }
    });

    it("bounds retained command metadata by bytes as well as block count", () => {
      const { blocks, write, dispose } = create();
      try {
        const command = "x".repeat(8192);
        for (let index = 0; index < 100; index++) {
          blocks.submitted(command);
          write("\x1b]133;C\x07\x1b]133;D;0\x07");
        }
        expect(blocks.diagnostics().metadataBytes).toBeLessThanOrEqual(
          512 * 1024,
        );
        expect(blocks.diagnostics().blocks).toBeLessThan(100);
        expect(blocks.readById("1")).toBeNull();
        expect(blocks.readById("100")?.command).toBe(command);
      } finally {
        dispose();
      }
    });

    it("retains the submitted command and never reruns a truncated label", () => {
      const { blocks, write, dispose } = create();
      try {
        const command = "echo ".repeat(100);
        blocks.submitted(command);
        write(`\x1b]133;C;${command.slice(0, 256)}\x07\x1b]133;D;0\x07`);
        expect(blocks.readById("1")?.command).toBe(command);
        expect(blocks.visibleBlocks(20).blocks[0].canRerun).toBe(true);
        blocks.submitted("x".repeat(8193));
        write("\x1b]133;C;label\x07\x1b]133;D;0\x07");
        expect(blocks.visibleBlocks(20).blocks[1].canRerun).toBe(false);
      } finally {
        dispose();
      }
    });
  },
);

it("maps Unicode search offsets to terminal cells", () => {
  expect(
    matchCellText(["a", "日", "", "e\u0301", " ", "İ", "z"], "E\u0301"),
  ).toEqual([{ col: 3, len: 1 }]);
  expect(matchCellText(["İ", "z"], "Z")).toEqual([{ col: 1, len: 1 }]);
});
