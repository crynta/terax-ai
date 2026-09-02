import { describe, expect, it, vi } from "vitest";
import {
  excludeNestedSources,
  executeBatchMove,
  type FsMoveResult,
} from "./batchMove";

function deps(
  move: (expectedConflict: string | null) => Promise<FsMoveResult>,
  overrides: Partial<Parameters<typeof executeBatchMove>[2]> = {},
): Parameters<typeof executeBatchMove>[2] {
  return {
    move: (_item, expectedConflict) => move(expectedConflict),
    resolveConflict: async () => "replace",
    canReplace: () => true,
    onMoved: () => undefined,
    isCurrent: () => true,
    ...overrides,
  };
}

describe("excludeNestedSources", () => {
  it("keeps unrelated paths whose names merely share a prefix", () => {
    expect(
      excludeNestedSources(["/repo/src", "/repo/src-backup/a.ts"]),
    ).toEqual(["/repo/src", "/repo/src-backup/a.ts"]);
  });

  it("drops descendants at any selected depth", () => {
    expect(
      excludeNestedSources([
        "/repo/src",
        "/repo/src/a.ts",
        "/repo/src/deep/b.ts",
        "/repo/other.ts",
      ]),
    ).toEqual(["/repo/src", "/repo/other.ts"]);
  });

  it("normalizes Windows descendants before filtering", () => {
    expect(
      excludeNestedSources(["C:\\repo\\src", "C:\\repo\\src\\a.ts"]),
    ).toEqual(["C:/repo/src"]);
  });
});

describe("executeBatchMove", () => {
  it("moves items sequentially and reports their final mappings", async () => {
    let active = 0;
    let maxActive = 0;
    const move = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return { status: "moved" } as const;
    });
    const onMoved = vi.fn();

    const result = await executeBatchMove(
      ["/repo/a.ts", "/repo/dest/already.ts", "/repo/b.ts"],
      "/repo/dest",
      deps(move, { onMoved }),
    );

    expect(maxActive).toBe(1);
    expect(result.moved).toBe(2);
    expect(onMoved).toHaveBeenCalledTimes(2);
  });

  it("builds canonical destinations from Windows paths", async () => {
    const onMoved = vi.fn();
    await executeBatchMove(
      ["C:\\repo\\a.ts"],
      "C:\\repo\\dest",
      deps(async () => ({ status: "moved" }), { onMoved }),
    );
    expect(onMoved).toHaveBeenCalledWith({
      from: "C:/repo/a.ts",
      to: "C:/repo/dest/a.ts",
      name: "a.ts",
    });
  });

  it("asks only after the backend reports a real filesystem conflict", async () => {
    const move = vi
      .fn<(expectedConflict: string | null) => Promise<FsMoveResult>>()
      .mockResolvedValueOnce({
        status: "conflict",
        replaceable: true,
        token: "v1",
      })
      .mockResolvedValueOnce({ status: "moved" });
    const resolveConflict = vi.fn(async () => "replace" as const);

    const result = await executeBatchMove(
      ["/repo/Foo.ts"],
      "/repo/dest",
      deps(move, { resolveConflict }),
    );

    expect(move.mock.calls).toEqual([[null], ["v1"]]);
    expect(resolveConflict).toHaveBeenCalledOnce();
    expect(result.moved).toBe(1);
  });

  it("does not replace a destination with an open editor", async () => {
    const move = vi.fn(
      async () =>
        ({ status: "conflict", replaceable: true, token: "v1" }) as const,
    );
    const result = await executeBatchMove(
      ["/repo/a.ts"],
      "/repo/dest",
      deps(move, { canReplace: () => false }),
    );

    expect(move).toHaveBeenCalledOnce();
    expect(result.blocked).toBe(1);
    expect(result.moved).toBe(0);
  });

  it("cancels before replacement when the workspace changes during the prompt", async () => {
    let current = true;
    const move = vi.fn(
      async () =>
        ({ status: "conflict", replaceable: true, token: "v1" }) as const,
    );
    const resolveConflict = vi.fn(async () => {
      current = false;
      return "replace" as const;
    });

    const result = await executeBatchMove(
      ["/repo/a.ts"],
      "/repo/dest",
      deps(move, { resolveConflict, isCurrent: () => current }),
    );

    expect(move).toHaveBeenCalledOnce();
    expect(result.moved).toBe(0);
  });

  it("keeps a completed move in the outcome before cancelling the remainder", async () => {
    let current = true;
    const move = vi.fn(async () => {
      current = false;
      return { status: "moved" } as const;
    });

    const result = await executeBatchMove(
      ["/repo/a.ts", "/repo/b.ts"],
      "/repo/dest",
      deps(move, { isCurrent: () => current }),
    );

    expect(result.moved).toBe(1);
  });

  it("skips folder conflicts without offering destructive replacement", async () => {
    const move = vi.fn(
      async () =>
        ({ status: "conflict", replaceable: false, token: "folder" }) as const,
    );
    const resolveConflict = vi.fn(async () => "replace" as const);

    const result = await executeBatchMove(
      ["/repo/folder"],
      "/repo/dest",
      deps(move, { resolveConflict }),
    );

    expect(resolveConflict).not.toHaveBeenCalled();
    expect(result.moved).toBe(0);
    expect(result.failures).toBe(1);
  });
});
