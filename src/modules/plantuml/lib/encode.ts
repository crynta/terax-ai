const PLANTUML_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

function encode6bit(b: number): string {
  return PLANTUML_ALPHABET[b & 0x3f];
}

function encode3bytes(b1: number, b2: number, b3: number): string {
  return (
    encode6bit(b1 >> 2) +
    encode6bit(((b1 & 0x3) << 4) | (b2 >> 4)) +
    encode6bit(((b2 & 0xf) << 2) | (b3 >> 6)) +
    encode6bit(b3 & 0x3f)
  );
}

function plantumlEncode(data: Uint8Array): string {
  let result = "";
  const len = data.length;
  for (let i = 0; i < len; i += 3) {
    const b1 = data[i];
    const b2 = i + 1 < len ? data[i + 1] : 0;
    const b3 = i + 2 < len ? data[i + 2] : 0;
    result += encode3bytes(b1, b2, b3);
  }
  return result;
}

export async function encodePlantUml(text: string): Promise<string> {
  const utf8 = new TextEncoder().encode(text);
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(utf8);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLen += value.length;
  }
  const deflated = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    deflated.set(chunk, offset);
    offset += chunk.length;
  }
  return plantumlEncode(deflated);
}
