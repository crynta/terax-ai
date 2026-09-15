const ESC = 0x1b;
const BEL = 0x07;
const CANCEL = 0x18;
const SUBSTITUTE = 0x1a;
const CSI = 0x9b;
const STRING_TERMINATOR = 0x9c;

const PRIMARY_DEVICE_ATTRIBUTES = new Uint8Array([
  ESC,
  0x5b,
  0x3f,
  0x36,
  0x32,
  0x3b,
  0x32,
  0x32,
  0x63,
]);
const SECONDARY_DEVICE_ATTRIBUTES = new Uint8Array([
  ESC,
  0x5b,
  0x3e,
  0x31,
  0x3b,
  0x31,
  0x30,
  0x3b,
  0x30,
  0x63,
]);

enum ParserState {
  Ground,
  Escape,
  Csi,
  Osc,
  ControlString,
  StringEscape,
}

enum DeviceAttributesCandidate {
  Empty,
  Zero,
  GreaterThan,
  GreaterThanZero,
  Invalid,
}

export type TerminalQueryReply = {
  /** Exclusive offset in the current input chunk. */
  readonly endOffset: number;
  readonly bytes: Uint8Array;
};

/**
 * Supplies replies missing from the pinned libghostty-vt WASM ABI.
 *
 * This is a byte-stream state machine rather than a string or regular
 * expression search. Queries may cross PTY chunks, and query-like bytes inside
 * OSC/DCS strings must never be interpreted as terminal protocol.
 */
export class TerminalQueryFallback {
  private state = ParserState.Ground;
  private stringState = ParserState.ControlString;
  private candidate = DeviceAttributesCandidate.Empty;
  private utf8ContinuationBytes = 0;

  scan(bytes: Uint8Array): TerminalQueryReply[] {
    const replies: TerminalQueryReply[] = [];

    for (let index = 0; index < bytes.byteLength; index += 1) {
      const byte = bytes[index];

      switch (this.state) {
        case ParserState.Ground:
          this.scanGround(byte);
          break;
        case ParserState.Escape:
          this.scanEscape(byte);
          break;
        case ParserState.Csi: {
          const response = this.scanCsi(byte);
          if (response) {
            replies.push({ endOffset: index + 1, bytes: response });
          }
          break;
        }
        case ParserState.Osc:
        case ParserState.ControlString:
          this.scanControlString(byte);
          break;
        case ParserState.StringEscape:
          this.scanStringEscape(byte);
          break;
      }
    }

    return replies;
  }

  private scanGround(byte: number): void {
    if (this.consumeUtf8Byte(byte)) return;
    if (byte === ESC) {
      this.state = ParserState.Escape;
    } else if (byte === CSI) {
      this.beginCsi();
    } else if (byte === 0x9d) {
      this.beginControlString(ParserState.Osc);
    } else if (isEightBitControlString(byte)) {
      this.beginControlString(ParserState.ControlString);
    }
  }

  private scanEscape(byte: number): void {
    if (byte === ESC) return;
    if (byte === 0x5b) {
      this.beginCsi();
    } else if (byte === 0x5d) {
      this.beginControlString(ParserState.Osc);
    } else if (isSevenBitControlString(byte)) {
      this.beginControlString(ParserState.ControlString);
    } else {
      this.state = ParserState.Ground;
    }
  }

  private scanCsi(byte: number): Uint8Array | null {
    if (byte === ESC) {
      this.state = ParserState.Escape;
      return null;
    }
    if (byte === CANCEL || byte === SUBSTITUTE) {
      this.state = ParserState.Ground;
      return null;
    }
    if (byte >= 0x40 && byte <= 0x7e) {
      const response =
        byte === 0x63 ? responseForCandidate(this.candidate) : null;
      this.state = ParserState.Ground;
      return response;
    }

    this.candidate = nextCandidate(this.candidate, byte);
    return null;
  }

  private scanControlString(byte: number): void {
    if (this.consumeUtf8Byte(byte)) return;
    if (byte === STRING_TERMINATOR) {
      this.state = ParserState.Ground;
      return;
    }
    if (this.state === ParserState.Osc && byte === BEL) {
      this.state = ParserState.Ground;
      return;
    }
    if (byte === ESC) {
      this.stringState = this.state;
      this.state = ParserState.StringEscape;
    }
  }

  private scanStringEscape(byte: number): void {
    if (byte === 0x5c) {
      this.state = ParserState.Ground;
      return;
    }
    if (byte === ESC) return;

    this.state = this.stringState;
    this.scanControlString(byte);
  }

  private beginCsi(): void {
    this.state = ParserState.Csi;
    this.candidate = DeviceAttributesCandidate.Empty;
    this.utf8ContinuationBytes = 0;
  }

  private beginControlString(state: ParserState): void {
    this.state = state;
    this.stringState = state;
    this.utf8ContinuationBytes = 0;
  }

  private consumeUtf8Byte(byte: number): boolean {
    if (this.utf8ContinuationBytes > 0) {
      if (byte >= 0x80 && byte <= 0xbf) {
        this.utf8ContinuationBytes -= 1;
        return true;
      }
      this.utf8ContinuationBytes = 0;
      return false;
    }

    if (byte >= 0xc2 && byte <= 0xdf) {
      this.utf8ContinuationBytes = 1;
      return true;
    }
    if (byte >= 0xe0 && byte <= 0xef) {
      this.utf8ContinuationBytes = 2;
      return true;
    }
    if (byte >= 0xf0 && byte <= 0xf4) {
      this.utf8ContinuationBytes = 3;
      return true;
    }
    return false;
  }
}

function nextCandidate(
  candidate: DeviceAttributesCandidate,
  byte: number,
): DeviceAttributesCandidate {
  if (candidate === DeviceAttributesCandidate.Empty) {
    if (byte === 0x30) return DeviceAttributesCandidate.Zero;
    if (byte === 0x3e) return DeviceAttributesCandidate.GreaterThan;
  } else if (
    candidate === DeviceAttributesCandidate.GreaterThan &&
    byte === 0x30
  ) {
    return DeviceAttributesCandidate.GreaterThanZero;
  }
  return DeviceAttributesCandidate.Invalid;
}

function responseForCandidate(
  candidate: DeviceAttributesCandidate,
): Uint8Array | null {
  if (
    candidate === DeviceAttributesCandidate.Empty ||
    candidate === DeviceAttributesCandidate.Zero
  ) {
    return PRIMARY_DEVICE_ATTRIBUTES;
  }
  if (
    candidate === DeviceAttributesCandidate.GreaterThan ||
    candidate === DeviceAttributesCandidate.GreaterThanZero
  ) {
    return SECONDARY_DEVICE_ATTRIBUTES;
  }
  return null;
}

function isSevenBitControlString(byte: number): boolean {
  return byte === 0x50 || byte === 0x58 || byte === 0x5e || byte === 0x5f;
}

function isEightBitControlString(byte: number): boolean {
  return byte === 0x90 || byte === 0x98 || byte === 0x9e || byte === 0x9f;
}
