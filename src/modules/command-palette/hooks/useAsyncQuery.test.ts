import { expect, it, vi } from "vitest";
import { useAsyncQuery } from "./useAsyncQuery";

const harness = vi.hoisted(() => ({
  snapshot: null as unknown,
  requestId: { current: 0 },
  effect: undefined as (() => (() => void) | undefined) | undefined,
}));

vi.mock("react", () => ({
  useCallback: <T>(callback: T) => callback,
  useEffect: (effect: () => (() => void) | undefined) => {
    harness.effect = effect;
  },
  useRef: () => harness.requestId,
  useState: () => [
    harness.snapshot,
    (value: unknown) => {
      harness.snapshot = value;
    },
  ],
}));

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
