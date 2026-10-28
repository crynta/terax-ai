import { describe, expect, it } from "vitest";
import {
  allocateScrollbackBytes,
  DEFAULT_SCROLLBACK_BUDGET_BYTES,
  MIN_SCROLLBACK_BYTES,
  normalizeScrollbackLines,
  requestedScrollbackBytes,
  SCROLLBACK_FLOOR_BYTES,
} from "./scrollbackBudget";

const MIB = 1024 * 1024;
const idle = (request: number) => ({ request, held: 0 });
const total = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0);

describe("scrollback request", () => {
  it("derives the byte limit from lines and columns within fixed bounds", () => {
    expect(requestedScrollbackBytes(10_000, 120)).toBe(9_600_000);
    expect(requestedScrollbackBytes(10, 80)).toBe(MIN_SCROLLBACK_BYTES);
    expect(requestedScrollbackBytes(100_000, 500)).toBe(64 * MIB);
  });

  it("normalizes the configured line count", () => {
    expect(normalizeScrollbackLines(undefined)).toBe(10_000);
    expect(normalizeScrollbackLines(Number.NaN)).toBe(10_000);
    expect(normalizeScrollbackLines(0)).toBe(1);
    expect(normalizeScrollbackLines(2_500.4)).toBe(2_500);
    expect(normalizeScrollbackLines(5_000_000)).toBe(100_000);
  });
});

describe("allocateScrollbackBytes", () => {
  it("grants every request while the total fits the budget", () => {
    expect(
      allocateScrollbackBytes([idle(4 * MIB), idle(8 * MIB)], 12 * MIB),
    ).toEqual([4 * MIB, 8 * MIB]);
    expect(allocateScrollbackBytes([], 12 * MIB)).toEqual([]);
  });

  it("splits an exceeded budget evenly between equal idle requests", () => {
    const grants = allocateScrollbackBytes(
      [idle(10 * MIB), idle(10 * MIB), idle(10 * MIB)],
      12 * MIB,
    );
    expect(grants).toEqual([4 * MIB, 4 * MIB, 4 * MIB]);
  });

  it("keeps small requests whole and shares the remainder among the large", () => {
    const grants = allocateScrollbackBytes(
      [idle(2 * MIB), idle(20 * MIB), idle(20 * MIB)],
      20 * MIB,
    );
    expect(grants).toEqual([2 * MIB, 9 * MIB, 9 * MIB]);
  });

  it("never takes held history away from a terminal", () => {
    const grants = allocateScrollbackBytes(
      [{ request: 20 * MIB, held: 18 * MIB }, idle(20 * MIB), idle(20 * MIB)],
      24 * MIB,
    );
    expect(grants[0]).toBeGreaterThanOrEqual(18 * MIB);
    expect(grants[1]).toBe(grants[2]);
    expect(grants[1]).toBeLessThan(3 * MIB);
    expect(total(grants)).toBeLessThanOrEqual(24 * MIB);
    expect(total(grants)).toBeGreaterThan(24 * MIB - 3);
  });

  it("freezes everyone at what they hold once the budget is already spent", () => {
    const grants = allocateScrollbackBytes(
      [
        { request: 20 * MIB, held: 15 * MIB },
        { request: 20 * MIB, held: 15 * MIB },
        idle(20 * MIB),
      ],
      24 * MIB,
    );
    expect(grants).toEqual([15 * MIB, 15 * MIB, SCROLLBACK_FLOOR_BYTES]);
  });

  it("caps a grant at its request even when more is held", () => {
    expect(
      allocateScrollbackBytes([{ request: 4 * MIB, held: 6 * MIB }], 100 * MIB),
    ).toEqual([4 * MIB]);
  });

  it("preserves input order and never grants more than requested", () => {
    const demands = [
      idle(30 * MIB),
      idle(3 * MIB),
      idle(64 * MIB),
      { request: 9 * MIB, held: 5 * MIB },
    ];
    const grants = allocateScrollbackBytes(demands, 40 * MIB);
    grants.forEach((grant, index) => {
      expect(grant).toBeLessThanOrEqual(demands[index].request);
      expect(grant).toBeGreaterThanOrEqual(
        Math.min(demands[index].request, SCROLLBACK_FLOOR_BYTES),
      );
    });
    expect(grants[1]).toBe(3 * MIB);
    expect(total(grants)).toBeLessThanOrEqual(40 * MIB);
  });

  it("bounds the total by the budget plus one floor per terminal beyond it", () => {
    const demands = Array.from({ length: 300 }, () => idle(9_600_000));
    const grants = allocateScrollbackBytes(
      demands,
      DEFAULT_SCROLLBACK_BUDGET_BYTES,
    );
    expect(grants.every((grant) => grant === SCROLLBACK_FLOOR_BYTES)).toBe(
      true,
    );
    expect(total(grants)).toBe(300 * SCROLLBACK_FLOOR_BYTES);
  });

  it("does not scale twenty default 120-column terminals under the default budget", () => {
    const demands = Array.from({ length: 20 }, () =>
      idle(requestedScrollbackBytes(10_000, 120)),
    );
    expect(
      allocateScrollbackBytes(demands, DEFAULT_SCROLLBACK_BUDGET_BYTES),
    ).toEqual(demands.map((demand) => demand.request));
  });

  it("bounds thirty default terminals by the budget", () => {
    const demands = Array.from({ length: 30 }, () =>
      idle(requestedScrollbackBytes(10_000, 120)),
    );
    const grants = allocateScrollbackBytes(
      demands,
      DEFAULT_SCROLLBACK_BUDGET_BYTES,
    );
    expect(total(grants)).toBeLessThanOrEqual(DEFAULT_SCROLLBACK_BUDGET_BYTES);
    expect(total(grants)).toBeGreaterThan(DEFAULT_SCROLLBACK_BUDGET_BYTES - 30);
    expect(Math.max(...grants) - Math.min(...grants)).toBeLessThanOrEqual(1);
  });

  it("bounds thirty terminals that are all full before the later ones open", () => {
    const request = requestedScrollbackBytes(10_000, 120);
    const demands = [
      ...Array.from({ length: 20 }, () => ({ request, held: request })),
      ...Array.from({ length: 10 }, () => idle(request)),
    ];
    const grants = allocateScrollbackBytes(
      demands,
      DEFAULT_SCROLLBACK_BUDGET_BYTES,
    );
    expect(grants.slice(0, 20).every((grant) => grant === request)).toBe(true);
    expect(total(grants)).toBeLessThanOrEqual(
      DEFAULT_SCROLLBACK_BUDGET_BYTES + 10 * SCROLLBACK_FLOOR_BYTES,
    );
  });
});
