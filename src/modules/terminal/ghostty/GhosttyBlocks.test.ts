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

    it("ends a command whose shell replaced itself when the next prompt starts", () => {
      const { blocks, write, dispose } = create();
      try {
        // `exec zsh`: C, then the new shell's prompt with no D in between.
        write("\x1b]133;B\x07\x1b]133;C;exec zsh\x07");
        expect(blocks.mode).toBe("running");
        expect(blocks.visibleBlocks(20).blocks[0].running).toBe(true);
        write("\x1b]133;A\x07new> \x1b]133;B\x07");
        expect(blocks.mode).toBe("prompt");
        expect(blocks.visibleBlocks(20).blocks[0].running).toBe(false);
        write("\x1b]133;C;next\x07out\r\n");
        write("\x1b]133;D;0\x07\x1b]133;A\x07");
        const shown = blocks.visibleBlocks(20).blocks;
        expect(shown.map((block) => block.running)).toEqual([false, false]);
        expect(shown[0].exitCode).toBeNull();
        expect(shown[1].exitCode).toBe(0);
      } finally {
        dispose();
      }
    });

    it("keeps the output of a command ended by the next prompt instead of closing it empty", () => {
      const { blocks, write, dispose } = create();
      try {
        write("$ \x1b]133;B\x07\x1b]133;C;long\x07one\r\ntwo\r\nthree\r\n");
        // The shell died or replaced itself: no D, the next prompt follows.
        write("\x1b]133;A\x07new> \x1b]133;B\x07");
        const [block] = blocks.visibleBlocks(20).blocks;
        expect(block.running).toBe(false);
        expect(block.exitCode).toBeNull();
        expect(blocks.readById("1")).toEqual({
          command: "long",
          cwd: "/workspace",
          exitCode: null,
          output: "one\ntwo\nthree",
        });
        // And the following command still gets its own block.
        write("\x1b]133;C;next\x07out\r\n\x1b]133;D;0\x07");
        expect(blocks.readById("2")?.output).toBe("out");
        expect(blocks.readById("1")?.output).toBe("one\ntwo\nthree");
      } finally {
        dispose();
      }
    });

    it("ends an implicitly closed command where its prompt started, not where the chunk ended", () => {
      const { blocks, write, dispose } = create();
      try {
        write("$ \x1b]133;B\x07\x1b]133;C;long\x07one\r\ntwo\r\n");
        // One read holds the new prompt and a lot more after it.
        write(
          "\x1b]133;A\x07new> \x1b]133;B\x07\r\nlater\r\nlines\r\nof\r\ntext\r\n",
        );
        expect(blocks.readById("1")).toMatchObject({
          exitCode: null,
          output: "one\ntwo",
        });
        const [block] = blocks.visibleBlocks(20).blocks;
        expect(block.running).toBe(false);
      } finally {
        dispose();
      }
    });

    it("keeps a last output line that has no newline when its prompt ends the command", () => {
      const { blocks, write, dispose } = create();
      try {
        write("$ \x1b]133;B\x07\r\n\x1b]133;C;printf\x07one\r\nabc");
        write("\x1b]133;A\x07new> \x1b]133;B\x07\r\nlater\r\n");
        expect(blocks.readById("1")?.output).toBe("one\nabc");
        write("\x1b]133;C;bare\x07x");
        write("\x1b]133;A\x07new> ");
        expect(blocks.readById("2")?.output).toBe("x");
      } finally {
        dispose();
      }
    });

    it("tracks an implicit prompt endpoint through narrow and wide reflow", () => {
      const { model, blocks, write, dispose } = create();
      try {
        const output = "abcdefghijklmnopqrstuvwxyz0123456789";
        write(`\x1b]133;B\x07\x1b]133;C;exec\x07${output}\x1b]133;A\x07prompt> \x1b]133;B\x07`);
        for (const cols of [10, 40, 15, 20]) {
          model.resize(cols, 6);
          expect(blocks.readById("1")?.output).toBe(output);
        }
      } finally {
        dispose();
      }
    });

    it("resolves each event of a chunk at the point where it was parsed", () => {
      const { blocks, write, dispose } = create();
      try {
        write("$ \x1b]133;B\x07\x1b]133;C;first\x07one\r\ntwo\r\n");
        // The replacement shell's prompt, a command and its end, in one read.
        write(
          "\x1b]133;A\x07new> \x1b]133;B\x07\x1b]133;C;second\x07alpha\r\nbeta\r\n\x1b]133;D;0\x07\x1b]133;A\x07",
        );
        expect(blocks.readById("1")?.output).toBe("one\ntwo");
        expect(blocks.readById("2")).toMatchObject({
          command: "second",
          exitCode: 0,
          output: "alpha\nbeta",
        });
      } finally {
        dispose();
      }
    });

    it("finds the prompt start even when the sequence arrives in pieces", () => {
      const { blocks, write, dispose } = create();
      try {
        write("$ \x1b]133;B\x07\x1b]133;C;long\x07one\r\ntwo\r\n");
        write("\x1b]13");
        write("3;A");
        write("\x1b\\new> \x1b]133;B\x07\r\nmore\r\nmore\r\n");
        expect(blocks.readById("1")?.output).toBe("one\ntwo");
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
