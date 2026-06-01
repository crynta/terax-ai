import { describe, expect, it } from "vitest";

import { DormantRing } from "./dormantRing";

const decode = (chunks: Uint8Array[]): string =>
  chunks.map((c) => new TextDecoder().decode(c)).join("");

const drainToString = (ring: DormantRing): string => {
  const out: Uint8Array[] = [];
  ring.drain((b) => out.push(b));
  return decode(out);
};

const RIS = "\x1bc"; // ESC c — full hard reset (wipes screen + scrollback + modes)

describe("DormantRing", () => {
  it("replays buffered chunks in order when it has not overflowed", () => {
    const ring = new DormantRing(1024, 64);
    ring.push(new TextEncoder().encode("hello "));
    ring.push(new TextEncoder().encode("world"));
    expect(drainToString(ring)).toBe("hello world");
  });

  it("does not emit a notice when nothing was dropped", () => {
    const ring = new DormantRing(1024, 64);
    ring.push(new TextEncoder().encode("abc"));
    const out = drainToString(ring);
    expect(out).not.toContain("dropped output");
    expect(out).not.toContain(RIS);
  });

  it("never emits a RIS hard reset that would wipe scrollback (#660)", () => {
    // A single push larger than the byte cap takes the overflow fast-path.
    const ring = new DormantRing(64, 8);
    ring.push(new Uint8Array(256).fill(0x41)); // 256 × 'A'
    const out = drainToString(ring);
    expect(out).not.toContain(RIS);
    expect(out.charCodeAt(0)).toBe(0x18); // leads with CAN, not RIS
    expect(out).toContain("dropped output during hibernation");
    expect(out).toContain("A".repeat(64)); // tail (last byteCap bytes) preserved
  });

  it("emits the overflow notice exactly once when chunks are evicted (#660)", () => {
    const ring = new DormantRing(64, 4);
    for (let i = 0; i < 50; i++) {
      ring.push(new TextEncoder().encode(`chunk-${i};`));
    }
    const out = drainToString(ring);
    expect(out).not.toContain(RIS);
    expect(out.match(/dropped output during hibernation/g)?.length).toBe(1);
    expect(out.indexOf("dropped output")).toBeLessThan(out.indexOf("chunk-49"));
    expect(out).toContain("chunk-49;"); // newest survivor kept
    expect(out).not.toContain("chunk-0;"); // oldest evicted
  });

  it("resets internal state after draining", () => {
    const ring = new DormantRing(1024, 64);
    ring.push(new TextEncoder().encode("once"));
    expect(drainToString(ring)).toBe("once");
    expect(ring.byteLength()).toBe(0);
    expect(drainToString(ring)).toBe(""); // second drain yields nothing
  });
});
