import { beforeEach, expect, it, vi } from "vitest";
import { useAsyncQuery } from "./useAsyncQuery";

const harness = vi.hoisted(() => ({
  snapshot: null as unknown,
  requestId: { current: 0 },
  timer: { current: null as number | null },
  effect: undefined as (() => (() => void) | undefined) | undefined,
}));

vi.mock("react", () => ({
  useCallback: <T>(callback: T) => callback,
  useEffect: (effect: () => (() => void) | undefined) => {
    harness.effect = effect;
  },
  useRef: (initial: number | null) =>
    initial === null ? harness.timer : harness.requestId,
  useState: () => [
    harness.snapshot,
    (value: unknown) => {
      harness.snapshot = value;
    },
  ],
}));

beforeEach(() => {
  harness.snapshot = null;
  harness.requestId.current = 0;
  harness.timer.current = null;
  harness.effect = undefined;
});

function render(run: (term: string) => Promise<string[]>) {
  // biome-ignore lint/correctness/useHookAtTopLevel: hooks use the explicit test scheduler above.
  return useAsyncQuery({
    run,
    term: "needle",
    enabled: true,
    minLength: 2,
    debounceMs: 10,
  });
}

it("hides previous results and reruns the same query when its search source changes", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  try {
    let resolvePrevious: (results: string[]) => void = () => {};
    const previous = vi
      .fn<(term: string) => Promise<string[]>>()
      .mockResolvedValueOnce(["/old/file"])
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePrevious = resolve;
          }),
      );
    const next = vi.fn(async () => ["/new/file"]);
    render(previous);
    const cleanup = harness.effect?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(render(previous).results).toEqual(["/old/file"]);
    expect(render(next)).toMatchObject({
      results: [],
      loading: true,
      error: null,
    });
    render(previous).retry();
    render(next);
    cleanup?.();
    harness.effect?.();
    await vi.advanceTimersByTimeAsync(10);
    resolvePrevious(["/old/late"]);
    await Promise.resolve();
    expect(next).toHaveBeenCalledExactlyOnceWith("needle");
    expect(render(next)).toMatchObject({
      results: ["/new/file"],
      loading: false,
    });
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

it("runs a manual retry once when an automatic search is queued", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  try {
    const run = vi.fn(async () => ["/repo/file"]);
    const query = render(run);
    const cleanup = harness.effect?.();
    expect(run).not.toHaveBeenCalled();
    query.retry();
    await vi.advanceTimersByTimeAsync(10);
    expect(run).toHaveBeenCalledExactlyOnceWith("needle");
    expect(render(run)).toMatchObject({
      results: ["/repo/file"],
      loading: false,
    });
    cleanup?.();
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
