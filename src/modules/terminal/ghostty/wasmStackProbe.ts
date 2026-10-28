import type { TeraxGhosttyTerminal } from "@terax/ghostty-core/adapted";

/**
 * Test support for the WebAssembly shadow stack. The module places its stack
 * first in linear memory (`[0, stackTop)`, growing down), so an overflow
 * traps instead of corrupting data. A canary pattern written before any code
 * runs lets a workload report how deep the stack actually went.
 */

const CANARY = 0xa5;
const encoder = new TextEncoder();

type WasmLayout = {
  /** Initial value of the stack pointer: the stack occupies `[0, stackTop)`. */
  readonly stackTop: number;
  readonly initialPages: number;
  /** Start of the first and end of the last active data segment. */
  readonly dataStart: number;
  readonly dataEnd: number;
};

export function readWasmLayout(bytes: Uint8Array): WasmLayout {
  let position = 8;
  const unsigned = (): number => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = bytes[position++];
      result += (byte & 0x7f) * 2 ** shift;
      shift += 7;
      if ((byte & 0x80) === 0) return result;
    }
  };
  const signed = (): number => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = bytes[position++];
      result += (byte & 0x7f) * 2 ** shift;
      shift += 7;
      if ((byte & 0x80) === 0) {
        return byte & 0x40 ? result - 2 ** shift : result;
      }
    }
  };
  let stackTop = -1;
  let initialPages = -1;
  let dataStart = Number.POSITIVE_INFINITY;
  let dataEnd = 0;
  while (position < bytes.length) {
    const id = bytes[position++];
    const length = unsigned();
    const end = position + length;
    if (id === 5) {
      unsigned();
      const flags = bytes[position++];
      initialPages = unsigned();
      if (flags & 1) unsigned();
    } else if (id === 6) {
      unsigned();
      position += 2;
      position += 1;
      stackTop = signed();
    } else if (id === 11) {
      const count = unsigned();
      for (let index = 0; index < count; index += 1) {
        const mode = unsigned();
        if (mode !== 0) throw new Error("Unsupported data segment mode");
        position += 1;
        const offset = signed();
        while (bytes[position] !== 0x0b) position += 1;
        position += 1;
        const size = unsigned();
        position += size;
        dataStart = Math.min(dataStart, offset);
        dataEnd = Math.max(dataEnd, offset + size);
      }
    }
    position = end;
  }
  if (stackTop < 0 || initialPages < 0) {
    throw new Error("Could not read the WebAssembly memory layout");
  }
  return { stackTop, initialPages, dataStart, dataEnd };
}

export function fillStackCanary(
  memory: WebAssembly.Memory,
  stackTop: number,
): void {
  new Uint8Array(memory.buffer, 0, stackTop).fill(CANARY);
}

/** Bytes between the stack top and the deepest address a workload wrote. */
export function peakStackBytes(
  memory: WebAssembly.Memory,
  stackTop: number,
): number {
  const stack = new Uint8Array(memory.buffer, 0, stackTop);
  let lowest = 0;
  while (lowest < stackTop && stack[lowest] === CANARY) lowest += 1;
  return stackTop - lowest;
}

type AdversarialInput = {
  readonly name: string;
  readonly bytes: Uint8Array;
};

function text(value: string): Uint8Array {
  return encoder.encode(value);
}

function base64Payload(length: number): string {
  return "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=".repeat(Math.ceil(length / 36));
}

/**
 * Inputs that stress parser state: very long strings, huge parameter lists,
 * runaway nesting of string introducers and cluster-forming sequences.
 */
export function adversarialInputs(): AdversarialInput[] {
  const mebibyte = 1024 * 1024;
  const inputs: AdversarialInput[] = [
    {
      name: "OSC 0 title of 1 MiB",
      bytes: text(`\x1b]0;${"T".repeat(mebibyte)}\x07`),
    },
    {
      name: "OSC 2 title terminated by ST",
      bytes: text(`\x1b]2;${"é".repeat(mebibyte / 2)}\x1b\\`),
    },
    {
      name: "OSC 8 hyperlink with a 256 KiB URI and 100k distinct ids",
      bytes: text(
        `\x1b]8;id=a;https://example.test/${"p".repeat(256 * 1024)}\x07x\x1b]8;;\x07` +
          Array.from(
            { length: 100_000 },
            (_, index) =>
              `\x1b]8;id=${index};https://e.test/${index}\x1b\\k\x1b]8;;\x1b\\`,
          ).join(""),
      ),
    },
    {
      name: "OSC 52 clipboard write of 1 MiB",
      bytes: text(`\x1b]52;c;${base64Payload(mebibyte)}\x07`),
    },
    {
      name: "OSC 7 working directory of 512 KiB",
      bytes: text(`\x1b]7;file://host/${"d/".repeat(256 * 1024)}\x07`),
    },
    {
      name: "OSC 133 command text of 512 KiB",
      bytes: text(`\x1b]133;C;${"c".repeat(512 * 1024)}\x07\x1b]133;D;0\x07`),
    },
    {
      name: "OSC 9 and 777 notifications of 256 KiB",
      bytes: text(
        `\x1b]9;${"n".repeat(256 * 1024)}\x07\x1b]777;notify;title;${"b".repeat(256 * 1024)}\x07`,
      ),
    },
    {
      name: "unterminated OSC then reset",
      bytes: text(`\x1b]0;${"u".repeat(mebibyte)}\x1b[0m\x18\x1bc`),
    },
    {
      name: "OSC color queries and sets",
      bytes: text(
        `${"\x1b]4;1;?\x07\x1b]10;?\x07\x1b]11;?\x07\x1b]12;?\x07\x1b]104\x07".repeat(1_000)}`,
      ),
    },
    {
      name: "CSI SGR with 200k parameters",
      bytes: text(`\x1b[${"1;".repeat(200_000)}m`),
    },
    {
      name: "CSI SGR with colon sub-parameters",
      bytes: text(
        `\x1b[${"38:2::255:0:128;48:5:200;4:3;58:2::1:2:3;".repeat(50_000)}m`,
      ),
    },
    {
      name: "CSI with 1 MiB of semicolons",
      bytes: text(`\x1b[${";".repeat(mebibyte)}H`),
    },
    {
      name: "CSI with a run of intermediates",
      bytes: text(`\x1b[${" ".repeat(mebibyte)}q`),
    },
    {
      name: "CSI private mode lists",
      bytes: text(`\x1b[?${"2004;1049;1000;1006;2026;".repeat(40_000)}h`),
    },
    {
      name: "unterminated CSI with escape floods",
      bytes: text("\x1b".repeat(mebibyte)),
    },
    {
      name: "DCS with 1 MiB of parameters",
      bytes: text(`\x1bP${"1;".repeat(mebibyte / 2)}q#0;2;0;0;0\x1b\\`),
    },
    {
      name: "XTGETTCAP with many capabilities",
      bytes: text(`\x1bP+q${"436f;544e;524742;".repeat(2_000)}\x1b\\`),
    },
    {
      name: "DECRQSS requests",
      bytes: text(
        `${'\x1bP$qm\x1b\\\x1bP$q"p\x1b\\\x1bP$qr\x1b\\'.repeat(1_500)}`,
      ),
    },
    {
      name: "nested string introducers",
      bytes: text(`${"\x1bP\x1b_\x1b]0;\x1b^\x1bX".repeat(100_000)}\x1b\\`),
    },
    {
      name: "kitty graphics transmit of 1 MiB",
      bytes: text(`\x1b_Ga=T,f=100,t=d,i=1;${base64Payload(mebibyte)}\x1b\\`),
    },
    {
      name: "kitty graphics chunk and placement floods",
      bytes: text(
        `${"\x1b_Ga=T,f=32,s=1,v=1,i=7,m=1;AAAA\x1b\\\x1b_Gm=1;AAAA\x1b\\".repeat(20_000)}` +
          `${"\x1b_Ga=p,i=7,p=3,c=2,r=2\x1b\\\x1b_Ga=d\x1b\\".repeat(20_000)}`,
      ),
    },
    {
      name: "kitty graphics control floods",
      bytes: text(`\x1b_G${"a=q,".repeat(200_000)}i=1;\x1b\\`),
    },
    {
      name: "kitty keyboard stack pushes",
      bytes: text(`${"\x1b[>31u\x1b[<u\x1b[=15;2u".repeat(50_000)}`),
    },
    {
      name: "100k combining marks on one cell",
      bytes: text(`a${"́̂̃̄".repeat(25_000)}\r\n`),
    },
    {
      name: "zero width joiner emoji chains",
      bytes: text(
        `${"\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}".repeat(60_000)}\r\n`,
      ),
    },
    {
      name: "regional indicators, variation selectors and wide cells",
      bytes: text(`${"\u{1F1FA}\u{1F1F8}️⃣日本語\u{1F600}".repeat(80_000)}\r\n`),
    },
    {
      name: "malformed UTF-8",
      bytes: Uint8Array.from(
        { length: mebibyte },
        (_, index) => [0xc0, 0xe2, 0x82, 0xf0, 0x9f, 0xff, 0x80][index % 7],
      ),
    },
    {
      name: "NUL and C1 controls",
      bytes: Uint8Array.from({ length: mebibyte }, (_, index) =>
        index % 3 === 0 ? 0x00 : 0x80 + (index % 32),
      ),
    },
    {
      name: "scroll region and editing extremes",
      bytes: text(
        `${"\x1b[2;3r\x1b[999999999S\x1b[999999999T\x1b[999999999L\x1b[999999999M\x1b[999999999@\x1b[999999999P\x1b[999999999X\x1b[999999999I\x1b[999999999Z\x1b[999999999;999999999H\x1b[r".repeat(2_000)}`,
      ),
    },
    {
      name: "alternate screen and mode churn",
      bytes: text(
        `${"\x1b[?1049h\x1b[?47h\x1b[?1047h\x1b[?3h\x1b[?3l\x1b[?1049l\x1b#8\x1b[!p\x1b[?25l\x1b[?25h".repeat(20_000)}`,
      ),
    },
    {
      name: "repeat character and tab stops",
      bytes: text(`${"x\x1b[65535b\x1bH\x1b[3g\x1b[2W".repeat(2_000)}`),
    },
    {
      name: "device queries",
      bytes: text(
        `${"\x1b[c\x1b[>c\x1b[=c\x1b[5n\x1b[6n\x1b[?6n\x1b[18t\x1b[19t\x1b[?996n\x1b[>q\x1b[?u\x1bZ".repeat(1_500)}`,
      ),
    },
  ];
  return inputs;
}

type StackWorkloadReport = {
  readonly inputs: number;
  readonly bytes: number;
};

/**
 * Drives one terminal through the adversarial inputs and the operations that
 * walk scrollback (reflow, search, selection, text extraction, line reads),
 * in the requested render format. Any WebAssembly trap propagates.
 */
export function runStackWorkloads(
  terminal: TeraxGhosttyTerminal,
  format: "soa" | "gpu",
): StackWorkloadReport {
  if (format === "gpu") terminal.setRenderFormat("gpu");
  terminal.enableSemanticMarkers(true);
  const refresh = (): void => {
    if (format === "gpu") {
      terminal.updateGpuRenderState();
      terminal.acknowledgeGpuGlyphs();
    } else {
      terminal.updateRenderState();
    }
  };
  let bytes = 0;
  let inputs = 0;
  for (const input of adversarialInputs()) {
    for (let offset = 0; offset < input.bytes.byteLength; offset += 96 * 1024) {
      terminal.write(input.bytes.subarray(offset, offset + 96 * 1024));
    }
    terminal.drainEvents();
    terminal.drainOutputBytes();
    refresh();
    bytes += input.bytes.byteLength;
    inputs += 1;
  }

  terminal.write(text("\x1bc"));
  const wrapped = text(
    `${Array.from(
      { length: 4_000 },
      (_, line) =>
        `\x1b[3${line % 8}m${"wrapped λ 日本語 ".repeat(1 + (line % 40))}${line}\x1b[0m\r\n`,
    ).join("")}`,
  );
  terminal.write(wrapped);
  bytes += wrapped.byteLength;
  for (const cols of [1, 2, 7, 33, 120, 4_000, 5, 300, 80]) {
    terminal.resize(cols, cols < 10 ? 3 : 24);
    refresh();
    terminal.compactRenderState();
  }
  const total = terminal.scrollbar().total;
  terminal.setSearchQuery("wrapped");
  for (let step = 0; step < 64; step += 1) terminal.stepSearch(4_096);
  terminal.selectSearchMatch("next");
  terminal.selectSearchMatch("previous");
  terminal.searchViewportMatches();
  terminal.clearSearch();
  terminal.setSelection({
    anchor: { line: 0, column: 0 },
    focus: { line: Math.max(0, total - 1), column: 79 },
    rectangular: false,
  });
  terminal.selectionText();
  terminal.setSelection({
    anchor: { line: 3, column: 2 },
    focus: { line: Math.max(3, total - 1), column: 40 },
    rectangular: true,
  });
  terminal.selectionText();
  terminal.readTextRange(0, Math.max(0, total - 1));
  terminal.readLines(0, Math.max(0, total - 1));
  terminal.scrollViewportTo(total >> 1);
  terminal.scrollViewport(-1_000);
  refresh();
  for (let key = 0; key <= 174; key += 1) {
    for (const action of [0, 1, 2]) {
      terminal.encodeKey({
        action,
        key,
        mods: 0b1111,
        consumedMods: 1,
        utf8: "x",
        unshiftedCodepoint: 120,
      });
    }
  }
  return { inputs, bytes };
}
