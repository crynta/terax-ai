import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { TeraxGhostty } from "@terax/ghostty-core/adapted";

const bytes = (text: string) => new TextEncoder().encode(text);

describe.each(["ghostty-vt", "ghostty-vt-scalar"])(
  "parser-time prompt markers (%s)",
  (artifact) => {
    let core: TeraxGhostty;
    beforeAll(async () => {
      const file = await readFile(
        new URL(
          `../../../../packages/ghostty-core/adapted/${artifact}.wasm`,
          import.meta.url,
        ),
      );
      core = await TeraxGhostty.loadBytes(Uint8Array.from(file).buffer);
    });

    function markers(chunks: string[]) {
      const terminal = core.createTerminal(80, 6);
      terminal.enableSemanticMarkers(true);
      try {
        for (const chunk of chunks) terminal.write(bytes(chunk));
        return terminal
          .drainEvents()
          .filter((event) => event.type === "prompt-start")
          .map((event) => ({
            line: terminal.semanticMarkerLine(event.marker ?? 0),
            column: terminal.semanticMarkerColumn(event.marker ?? 0),
          }));
      } finally {
        terminal.dispose();
      }
    }

    it("reports where each prompt starts, BEL or ST terminated", () => {
      // Without a preceding command marker, A starts a fresh line.
      expect(
        markers(["out\r\n\x1b]133;A\x07new> \x1b]133;A;cl=m\x1b\\tail"]),
      ).toEqual([
        { line: 1, column: 0 },
        { line: 2, column: 0 },
      ]);
    });

    it("ignores every other sequence", () => {
      expect(
        markers([
          "\x1b[31mred\x1b[0m\x1b]133;B\x07\x1b]133;C;ls\x07\x1b]133;D;0\x07\x1b]7;file:///a\x07\x1b]133;\x07",
        ]),
      ).toEqual([]);
    });

    it("follows a sequence split at any byte", () => {
      const text = "x\x1b]133;A\x1b\\y\x1b]133;A\x07z";
      for (let split = 1; split < text.length; split++) {
        expect(
          markers([text.slice(0, split), text.slice(split)]),
          `split at ${split}`,
        ).toEqual([
          { line: 1, column: 0 },
          { line: 2, column: 0 },
        ]);
      }
    });

    it("gives up on an unterminated sequence and finds the next one", () => {
      expect(
        markers([`\x1b]133;A${"a".repeat(600)}`, "\x1b]133;A\x07"]),
      ).toEqual([{ line: 0, column: 0 }]);
      // Ghostty terminates OSC at ESC, including an ESC followed by another OSC.
      expect(markers(["\x1b]133;A\x1b\x1b]133;A\x07"])).toEqual([
        { line: 0, column: 0 },
        { line: 0, column: 0 },
      ]);
    });
  },
);
