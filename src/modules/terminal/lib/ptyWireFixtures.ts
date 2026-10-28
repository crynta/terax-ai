// Test-only counterparts to ptyWire.ts: the encoder native uses for responses
// and the decoder it uses for requests, so transport tests can play native.
import type { PtyAck, PtyFrame } from "@/modules/terminal/lib/ptyWire";

const encoder = new TextEncoder();

export function encodeFrames(frames: readonly PtyFrame[]): Uint8Array {
  const parts: Uint8Array[] = frames.map((frame) => {
    let kind: number;
    let payload: Uint8Array;
    switch (frame.kind) {
      case "data": {
        kind = 1;
        payload = new Uint8Array(8 + frame.bytes.length);
        const view = new DataView(payload.buffer);
        view.setUint32(0, frame.offset % 2 ** 32, true);
        view.setUint32(4, Math.floor(frame.offset / 2 ** 32), true);
        payload.set(frame.bytes, 8);
        break;
      }
      case "exit":
        kind = 2;
        payload = new Uint8Array(4);
        new DataView(payload.buffer).setInt32(0, frame.code, true);
        break;
      case "failed":
        kind = 3;
        payload = encoder.encode(frame.reason);
        break;
      case "sync":
        kind = 4;
        payload = new Uint8Array(0);
        break;
    }
    const out = new Uint8Array(9 + payload.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, frame.id, true);
    out[4] = kind;
    view.setUint32(5, payload.length, true);
    out.set(payload, 9);
    return out;
  });
  const body = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let at = 0;
  for (const part of parts) {
    body.set(part, at);
    at += part.length;
  }
  return body;
}

export function decodeRequest(body: Uint8Array): {
  token: string;
  acks: PtyAck[];
} {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const count = view.getUint32(8, true);
  if (body.length !== 12 + count * 12)
    throw new Error(
      `malformed request: ${body.length} bytes for ${count} acks`,
    );
  const token = [...body.subarray(0, 8)]
    .reverse()
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const acks: PtyAck[] = [];
  for (let index = 0; index < count; index++) {
    const at = 12 + index * 12;
    acks.push({
      id: view.getUint32(at, true),
      bytes:
        view.getUint32(at + 4, true) + view.getUint32(at + 8, true) * 2 ** 32,
    });
  }
  return { token, acks };
}
