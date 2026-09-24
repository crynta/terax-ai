import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMock = vi.hoisted(() => ({
  writeFile: vi.fn(),
  createDir: vi.fn(),
  canonicalize: vi.fn(async (path: string) => path),
}));

vi.mock("../lib/native", () => ({ native: nativeMock }));

const securityMock = vi.hoisted(() => ({
  checkWritableCanonical: vi.fn<
    (path: string) => Promise<{ ok: true; canonical: string } | { ok: false; reason: string }>
  >(),
}));

vi.mock("../lib/security", () => securityMock);

import { usePlanStore, type QueuedEdit } from "./planStore";

function edit(partial: Partial<QueuedEdit> = {}): QueuedEdit {
  return {
    id: partial.id ?? "q-1",
    kind: partial.kind ?? ("edit" as const),
    path: partial.path ?? "/repo/a.ts",
    originalContent: partial.originalContent ?? "old",
    proposedContent: partial.proposedContent ?? "new",
    isNewFile: partial.isNewFile ?? false,
    description: partial.description,
  };
}

describe("plan mode store", () => {
  beforeEach(() => {
    usePlanStore.setState({ active: false, queue: [] });
    nativeMock.writeFile.mockReset();
    nativeMock.createDir.mockReset();
    nativeMock.canonicalize.mockClear();
    nativeMock.canonicalize.mockImplementation(async (path: string) => path);
    securityMock.checkWritableCanonical.mockClear();
    securityMock.checkWritableCanonical.mockImplementation(
      async (path: string) => ({ ok: true, canonical: path }),
    );
  });

  it("keeps the queue when enabling and clears it when disabling", () => {
    usePlanStore.getState().enqueue(edit({}));
    usePlanStore.getState().enqueue(edit({ id: "q-2" }));

    usePlanStore.getState().enable();
    expect(usePlanStore.getState().active).toBe(true);
    expect(usePlanStore.getState().queue).toHaveLength(2);

    usePlanStore.getState().disable();
    expect(usePlanStore.getState().active).toBe(false);
    expect(usePlanStore.getState().queue).toEqual([]);
  });

  it("toggle clears queued edits only when switching off", () => {
    usePlanStore.getState().toggle();
    expect(usePlanStore.getState().active).toBe(true);

    usePlanStore.getState().enqueue(edit({}));
    usePlanStore.getState().toggle();

    expect(usePlanStore.getState().active).toBe(false);
    expect(usePlanStore.getState().queue).toEqual([]);
  });

  it("removeOne drops only the matching edit", () => {
    usePlanStore.getState().enqueue(edit({ id: "q-1" }));
    usePlanStore.getState().enqueue(edit({ id: "q-2" }));

    usePlanStore.getState().removeOne("q-1");

    expect(usePlanStore.getState().queue.map((q) => q.id)).toEqual(["q-2"]);
  });

  it("applies file writes in queue order and reports success per item", async () => {
    usePlanStore.getState().enqueue(edit({ id: "q-1", path: "/repo/a.ts" }));
    usePlanStore.getState().enqueue(edit({ id: "q-2", path: "/repo/b.ts" }));
    nativeMock.writeFile.mockResolvedValue(undefined);

    const results = await usePlanStore.getState().applyAll();

    expect(nativeMock.writeFile.mock.calls.map((c) => c[0])).toEqual([
      "/repo/a.ts",
      "/repo/b.ts",
    ]);
    expect(results).toEqual([
      { id: "q-1", ok: true },
      { id: "q-2", ok: true },
    ]);
    expect(usePlanStore.getState().queue).toEqual([]);
  });

  it("routes create_directory edits to mkdir instead of write", async () => {
    usePlanStore.getState().enqueue(
      edit({
        kind: "create_directory",
        path: "/repo/new-dir",
        description: "make dir",
        originalContent: "",
        proposedContent: "",
      }),
    );
    nativeMock.createDir.mockResolvedValue(undefined);

    const results = await usePlanStore.getState().applyAll();

    expect(nativeMock.createDir).toHaveBeenCalledWith("/repo/new-dir");
    expect(nativeMock.writeFile).not.toHaveBeenCalled();
    expect(results).toEqual([{ id: "q-1", ok: true }]);
  });

  it("captures a failed edit in its result and still drains the rest", async () => {
    usePlanStore.getState().enqueue(edit({ id: "q-1", path: "/repo/blocked" }));
    usePlanStore
      .getState()
      .enqueue(edit({ id: "q-2", path: "/repo/fine" }));
    nativeMock.writeFile.mockImplementation((path: string) =>
      path === "/repo/blocked"
        ? Promise.reject(new Error("denied"))
        : Promise.resolve(),
    );

    const results = await usePlanStore.getState().applyAll();

    expect(results[0]).toMatchObject({ id: "q-1", ok: false });
    expect(String(results[0].error)).toContain("denied");
    expect(results[1]).toEqual({ id: "q-2", ok: true });
    expect(usePlanStore.getState().queue).toEqual([]);
  });

  it("refuses denied paths at the mutation boundary without touching disk", async () => {
    usePlanStore
      .getState()
      .enqueue(edit({ id: "q-1", path: "/repo/.env" }));
    usePlanStore
      .getState()
      .enqueue({
        ...edit({ id: "q-2", path: "/repo/.ssh", kind: "create_directory" }),
        originalContent: "",
        proposedContent: "",
        description: "Create directory",
      });
    securityMock.checkWritableCanonical.mockImplementation(async (path: string) => ({
      ok: false as const,
      reason: `Refused: ${path}`,
    }));

    const results = await usePlanStore.getState().applyAll();

    expect(results.map((r) => r.ok)).toEqual([false, false]);
    expect(nativeMock.writeFile).not.toHaveBeenCalled();
    expect(nativeMock.createDir).not.toHaveBeenCalled();
    expect(usePlanStore.getState().queue).toEqual([]);
  });

  it("keeps edits enqueued while applyAll is pending and applies them later", async () => {
    let releaseWrite: (() => void) | undefined;
    nativeMock.writeFile.mockImplementation(
      (path: string) =>
        new Promise<void>((resolve) => {
          if (path === "/repo/first") {
            releaseWrite = () => resolve();
          } else {
            resolve();
          }
        }),
    );
    usePlanStore.getState().enqueue(edit({ id: "q-1", path: "/repo/first" }));

    const applying = usePlanStore.getState().applyAll();
    await vi.waitFor(() => expect(releaseWrite).toBeDefined());
    // Edit queued while the first write is still in flight.
    usePlanStore
      .getState()
      .enqueue(edit({ id: "q-2", path: "/repo/second" }));
    releaseWrite?.();

    const results = await applying;

    expect(results).toEqual([{ id: "q-1", ok: true }]);
    expect(usePlanStore.getState().queue.map((q) => q.id)).toEqual(["q-2"]);

    nativeMock.writeFile.mockResolvedValue(undefined);
    const second = await usePlanStore.getState().applyAll();
    expect(second).toEqual([{ id: "q-2", ok: true }]);
    expect(usePlanStore.getState().queue).toEqual([]);
  });
});
