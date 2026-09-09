export type OfficialGhosttyCallbackExports = WebAssembly.Exports & {
  readonly write_pty: CallableFunction;
};

type WritePtyHandler = (bytes: Uint8Array) => void;

// Equivalent WAT:
// (module
//   (import "terax" "write_pty" (func (param i32 i32 i32 i32)))
//   (export "write_pty" (func 0)))
//
// Exporting the typed import turns a JavaScript callback into a WebAssembly
// function reference. That reference can safely be installed in libghostty's
// exported indirect function table without relying on WebAssembly.Function.
const CALLBACK_MODULE_BYTES = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x01, 0x60, 0x04,
  0x7f, 0x7f, 0x7f, 0x7f, 0x00, 0x02, 0x13, 0x01, 0x05, 0x74, 0x65, 0x72, 0x61,
  0x78, 0x09, 0x77, 0x72, 0x69, 0x74, 0x65, 0x5f, 0x70, 0x74, 0x79, 0x00, 0x00,
  0x07, 0x0d, 0x01, 0x09, 0x77, 0x72, 0x69, 0x74, 0x65, 0x5f, 0x70, 0x74, 0x79,
  0x00, 0x00,
]);

export class OfficialGhosttyCallbackBridge {
  private readonly handlers = new Map<number, WritePtyHandler>();

  private constructor(
    readonly writePtyTableIndex: number,
    private readonly table: WebAssembly.Table,
  ) {}

  static async create(
    memory: WebAssembly.Memory,
    table: WebAssembly.Table,
  ): Promise<OfficialGhosttyCallbackBridge> {
    let bridge: OfficialGhosttyCallbackBridge | null = null;
    const { instance } = await WebAssembly.instantiate(CALLBACK_MODULE_BYTES, {
      terax: {
        write_pty: (
          terminal: number,
          _userdata: number,
          pointer: number,
          length: number,
        ) => {
          if (!bridge || length === 0) return;
          if (
            !Number.isSafeInteger(pointer) ||
            pointer < 0 ||
            !Number.isSafeInteger(length) ||
            length < 0 ||
            pointer + length > memory.buffer.byteLength
          ) {
            throw new Error(
              "libghostty write_pty callback returned invalid bytes",
            );
          }
          bridge.handlers.get(terminal)?.(
            new Uint8Array(memory.buffer, pointer, length),
          );
        },
      },
    });

    const callback = (instance.exports as OfficialGhosttyCallbackExports)
      .write_pty;
    if (typeof callback !== "function") {
      throw new Error("Failed to create the libghostty write_pty callback");
    }

    const tableIndex = table.grow(1);
    table.set(tableIndex, callback);
    bridge = new OfficialGhosttyCallbackBridge(tableIndex, table);
    return bridge;
  }

  register(terminal: number, handler: WritePtyHandler): void {
    if (this.handlers.has(terminal)) {
      throw new Error(`libghostty callback already registered for ${terminal}`);
    }
    this.handlers.set(terminal, handler);
  }

  unregister(terminal: number): void {
    this.handlers.delete(terminal);
  }

  dispose(): void {
    this.handlers.clear();
    this.table.set(this.writePtyTableIndex, null);
  }
}
