// Binary framing for the multiplexed `terax-pty` stream. Mirrors
// src-tauri/src/modules/pty/wire.rs; all integers are little-endian.
//
// Request body (`POST poll` and `POST ack`):
//   [u64 token][u32 count] then count x [u32 pty_id][u64 cumulative_parsed_bytes]
// Response body (`poll`): frames back to back:
//   [u32 pty_id][u8 kind][u32 len][payload]
//     data   (1): [u64 start_offset][bytes]
//     exit   (2): [i32 code]
//     failed (3): UTF-8 reason
//     sync   (4): empty (native is waiting on this PTY's acknowledgement)

const KIND_DATA = 1;
const KIND_EXIT = 2;
const KIND_FAILED = 3;
const KIND_SYNC = 4;

const FRAME_HEADER_BYTES = 9;
const DATA_PREFIX_BYTES = 8;
const REQUEST_HEADER_BYTES = 12;
const ACK_ENTRY_BYTES = 12;
const TOKEN_BYTES = 8;

/** Bytes a PTY may have delivered but unparsed (native `MAX_IN_FLIGHT_BYTES`). */
export const PTY_WINDOW_BYTES = 1024 * 1024;
/** Delivered chunks a PTY may have unacknowledged (native `MAX_IN_FLIGHT_CHUNKS`). */
export const PTY_WINDOW_CHUNKS = 128;
/**
 * Acknowledgements per request. Keeps a request body under 1 KiB, which
 * WebKitGTK's custom-protocol body reader handles in a single read.
 */
export const MAX_ACKS_PER_REQUEST = 64;

export type PtyAck = { id: number; bytes: number };

export type PtyFrame =
  | { kind: "data"; id: number; offset: number; bytes: Uint8Array }
  | { kind: "exit"; id: number; code: number }
  | { kind: "failed"; id: number; reason: string }
  | { kind: "sync"; id: number };

export class PtyWireError extends Error {}

const textDecoder = new TextDecoder("utf-8", { fatal: true });

/** The stream secret arrives as 16 hex digits (a u64 does not fit a JS number). */
export function tokenBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{16}$/i.test(hex))
    throw new PtyWireError("invalid stream token");
  const value = BigInt(`0x${hex}`);
  const bytes = new Uint8Array(TOKEN_BYTES);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

export function encodeRequest(
  token: Uint8Array,
  acks: readonly PtyAck[],
): Uint8Array<ArrayBuffer> {
  if (token.length !== TOKEN_BYTES)
    throw new PtyWireError("invalid stream token");
  if (acks.length > MAX_ACKS_PER_REQUEST)
    throw new PtyWireError("too many acknowledgements in one request");
  const body = new Uint8Array(
    REQUEST_HEADER_BYTES + acks.length * ACK_ENTRY_BYTES,
  );
  const view = new DataView(body.buffer);
  body.set(token, 0);
  view.setUint32(8, acks.length, true);
  let at = REQUEST_HEADER_BYTES;
  for (const ack of acks) {
    if (!Number.isSafeInteger(ack.bytes) || ack.bytes < 0)
      throw new PtyWireError("acknowledgement offset out of range");
    view.setUint32(at, ack.id, true);
    view.setUint32(at + 4, ack.bytes % 2 ** 32, true);
    view.setUint32(at + 8, Math.floor(ack.bytes / 2 ** 32), true);
    at += ACK_ENTRY_BYTES;
  }
  return body;
}

/** Decodes a whole response; any malformed byte means the stream is desynchronised. */
export function decodeFrames(body: Uint8Array): PtyFrame[] {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const frames: PtyFrame[] = [];
  let at = 0;
  while (at < body.length) {
    if (body.length - at < FRAME_HEADER_BYTES)
      throw new PtyWireError("truncated frame header");
    const id = view.getUint32(at, true);
    const kind = body[at + 4];
    const length = view.getUint32(at + 5, true);
    at += FRAME_HEADER_BYTES;
    if (length > body.length - at) throw new PtyWireError("truncated frame");
    const payload = body.subarray(at, at + length);
    at += length;
    switch (kind) {
      case KIND_DATA: {
        if (length <= DATA_PREFIX_BYTES)
          throw new PtyWireError("empty data frame");
        const low = view.getUint32(at - length, true);
        const high = view.getUint32(at - length + 4, true);
        if (high >= 2 ** 21)
          throw new PtyWireError("stream offset out of range");
        frames.push({
          kind: "data",
          id,
          offset: high * 2 ** 32 + low,
          bytes: payload.subarray(DATA_PREFIX_BYTES),
        });
        break;
      }
      case KIND_EXIT:
        if (length !== 4) throw new PtyWireError("malformed exit frame");
        frames.push({
          kind: "exit",
          id,
          code: view.getInt32(at - length, true),
        });
        break;
      case KIND_FAILED:
        try {
          frames.push({
            kind: "failed",
            id,
            reason: textDecoder.decode(payload),
          });
        } catch {
          throw new PtyWireError("malformed failure reason");
        }
        break;
      case KIND_SYNC:
        if (length !== 0) throw new PtyWireError("malformed sync frame");
        frames.push({ kind: "sync", id });
        break;
      default:
        throw new PtyWireError(`unknown frame kind ${kind}`);
    }
  }
  return frames;
}
