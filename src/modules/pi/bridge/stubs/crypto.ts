// Browser-compatible crypto shim for node:crypto.
// Pi SDK uses randomUUID, randomBytes, createHash.

export function randomUUID(): string {
  return crypto.randomUUID();
}

export function randomBytes(size: number): Uint8Array {
  const buf = new Uint8Array(size);
  crypto.getRandomValues(buf);
  return buf;
}

export function createHash(algorithm: string) {
  // Minimal shim — Pi SDK uses this for checksums
  const chunks: Uint8Array[] = [];
  return {
    update(data: string | Uint8Array) {
      if (typeof data === "string") {
        chunks.push(new TextEncoder().encode(data));
      } else {
        chunks.push(data);
      }
      return this;
    },
    async digest(encoding?: string): Promise<string> {
      const combined = new Uint8Array(
        chunks.reduce((acc, c) => acc + c.length, 0),
      );
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      const hash = await crypto.subtle.digest(
        algorithm === "sha256" ? "SHA-256" : "SHA-1",
        combined,
      );
      const arr = new Uint8Array(hash);
      if (encoding === "hex") {
        return Array.from(arr)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      }
      return String.fromCharCode(...arr);
    },
  };
}

export default { randomUUID, randomBytes, createHash };
