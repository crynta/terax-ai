const ESC = 0x1b;
const LBRACKET = 0x5b;
const FINAL_C = 0x63;
const PREFIX_GT = 0x3e;
const PREFIX_EQ = 0x3d;
const CSI_FINAL_MIN = 0x40;
const CSI_FINAL_MAX = 0x7e;

const HOLD_MAX = 256;

const DA1_REPLY = "\x1b[?1;2c";
const DA2_REPLY = "\x1b[>0;276;0c";

type State = 0 | 1 | 2; // idle | after-ESC | inside-CSI

export type DAFilter = {
  active: boolean;
  state: State;
  hold: number[];
};

export function createDAFilter(): DAFilter {
  return { active: true, state: 0, hold: [] };
}

export function filterDA(
  f: DAFilter,
  input: Uint8Array,
  respond: (reply: string) => void,
): Uint8Array {
  if (!f.active) return input;

  if (f.state === 0) {
    let hasEsc = false;
    for (let i = 0; i < input.length; i++) {
      if (input[i] === ESC) {
        hasEsc = true;
        break;
      }
    }
    if (!hasEsc) return input;
  }

  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const b = input[i];
    if (f.state === 0) {
      if (b === ESC) {
        f.state = 1;
        f.hold.length = 0;
        f.hold.push(b);
      } else {
        out.push(b);
      }
      continue;
    }
    if (f.state === 1) {
      if (b === LBRACKET) {
        f.state = 2;
        f.hold.push(b);
      } else if (b === ESC) {
        flushHold(f, out);
        f.state = 1;
        f.hold.push(b);
      } else {
        flushHold(f, out);
        out.push(b);
        f.state = 0;
      }
      continue;
    }
    f.hold.push(b);
    if (b >= CSI_FINAL_MIN && b <= CSI_FINAL_MAX) {
      if (b === FINAL_C) {
        const middleStart = 2;
        const middleEnd = f.hold.length - 1;
        const prefix = middleEnd > middleStart ? f.hold[middleStart] : 0;
        if (prefix === PREFIX_GT) {
          respond(DA2_REPLY);
        } else if (prefix === PREFIX_EQ) {
          // DA3: consumed silently.
        } else {
          // No private prefix (or numeric param only) -> DA1.
          respond(DA1_REPLY);
        }
        // Consume the sequence: never forwarded.
      } else {
        flushHold(f, out);
      }
      f.hold.length = 0;
      f.state = 0;
    } else if (f.hold.length >= HOLD_MAX) {
      flushHold(f, out);
      f.state = 0;
    }
  }

  return out.length === input.length ? input : new Uint8Array(out);
}

export function drainDAFilter(f: DAFilter): Uint8Array | null {
  if (f.hold.length === 0) return null;
  const out = new Uint8Array(f.hold);
  f.hold.length = 0;
  f.state = 0;
  return out;
}

function flushHold(f: DAFilter, out: number[]): void {
  for (let i = 0; i < f.hold.length; i++) out.push(f.hold[i]);
  f.hold.length = 0;
}
