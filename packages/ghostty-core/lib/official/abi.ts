export type GhosttyAbiField = {
  readonly offset: number;
  readonly size: number;
  readonly type: string;
};

export type GhosttyAbiStruct = {
  readonly size: number;
  readonly align: number;
  readonly fields: Readonly<Record<string, GhosttyAbiField>>;
};

export type GhosttyAbiLayout = Readonly<Record<string, GhosttyAbiStruct>>;

const MAX_TYPE_JSON_BYTES = 1024 * 1024;

export class OfficialGhosttyAbi {
  readonly layout: GhosttyAbiLayout;

  constructor(memory: WebAssembly.Memory, jsonPointer: number) {
    if (!Number.isSafeInteger(jsonPointer) || jsonPointer <= 0) {
      throw new Error("libghostty returned an invalid type-layout pointer");
    }

    const available = Math.min(
      memory.buffer.byteLength - jsonPointer,
      MAX_TYPE_JSON_BYTES,
    );
    if (available <= 0) {
      throw new Error("libghostty type-layout pointer is outside WASM memory");
    }

    const bytes = new Uint8Array(memory.buffer, jsonPointer, available);
    const terminator = bytes.indexOf(0);
    if (terminator < 0) {
      throw new Error("libghostty type-layout JSON is not null-terminated");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(
        new TextDecoder().decode(bytes.subarray(0, terminator)),
      );
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : "";
      throw new Error(`libghostty type-layout JSON is invalid${detail}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("libghostty type-layout JSON has an invalid root");
    }

    this.layout = parsed as GhosttyAbiLayout;
    this.requireStruct("GhosttyRenderStateColors", [
      "size",
      "background",
      "foreground",
      "cursor",
      "cursor_has_value",
      "palette",
    ]);
    this.requireStruct("GhosttyTerminalScrollbar", ["total", "offset", "len"]);
    this.requireStruct("GhosttyTerminalModeConfig", ["mode", "value"]);
    this.requireStruct("GhosttyString", ["ptr", "len"]);
  }

  struct(name: string): GhosttyAbiStruct {
    const value = this.layout[name];
    if (!value) throw new Error(`libghostty ABI is missing ${name}`);
    return value;
  }

  field(structName: string, fieldName: string): GhosttyAbiField {
    const value = this.struct(structName).fields[fieldName];
    if (!value) {
      throw new Error(`libghostty ABI is missing ${structName}.${fieldName}`);
    }
    return value;
  }

  private requireStruct(name: string, fields: readonly string[]): void {
    const value = this.struct(name);
    if (
      !Number.isSafeInteger(value.size) ||
      value.size <= 0 ||
      !Number.isSafeInteger(value.align) ||
      value.align <= 0
    ) {
      throw new Error(`libghostty ABI has an invalid ${name} layout`);
    }
    for (const field of fields) this.field(name, field);
  }
}
