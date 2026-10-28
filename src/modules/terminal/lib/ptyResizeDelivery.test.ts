import { describe, expect, it, vi } from "vitest";
import { PtyResizeDelivery } from "./ptyResizeDelivery";

describe("PtyResizeDelivery", () => {
  it("delivers immediately and skips repeats", () => {
    const deliver = vi.fn(() => true);
    const delivery = new PtyResizeDelivery(deliver);

    expect(delivery.send(80, 24)).toBe(true);
    expect(delivery.send(80, 24)).toBe(false);
    expect(delivery.send(100, 30)).toBe(true);

    expect(deliver.mock.calls).toEqual([
      [80, 24],
      [100, 30],
    ]);
    expect(delivery.diagnostics()).toEqual({
      requests: 3,
      deliveries: 2,
      delivered: { cols: 100, rows: 30 },
    });
  });

  it("does not remember a size the missing PTY never received", () => {
    let pty = false;
    const deliver = vi.fn(() => pty);
    const delivery = new PtyResizeDelivery(deliver);

    expect(delivery.send(90, 30)).toBe(false);
    pty = true;
    expect(delivery.send(90, 30)).toBe(true);
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it("forgets the old generation's size on reset", () => {
    const deliver = vi.fn(() => true);
    const delivery = new PtyResizeDelivery(deliver);
    delivery.send(80, 24);

    delivery.reset();

    expect(delivery.send(80, 24)).toBe(true);
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it("rejects dimensions a PTY cannot have", () => {
    const delivery = new PtyResizeDelivery(() => true);
    expect(() => delivery.send(0, 24)).toThrow(RangeError);
    expect(() => delivery.send(80, 2.5)).toThrow(RangeError);
  });
});
