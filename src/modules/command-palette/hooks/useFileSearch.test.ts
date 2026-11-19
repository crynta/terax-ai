import { beforeEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: harness.invoke }));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => ({ kind: "local" }),
}));
vi.mock("react", () => ({
  useState: () => [{ hits: [], loading: false, error: null }, vi.fn()],
  useRef: () => ({ current: 0 }),
  useCallback: <T>(fn: T) => fn,
  useEffect: (effect: () => void | (() => void)) =>
    harness.effects.push(effect),
}));
import { useFileSearch } from "./useFileSearch";

beforeEach(() => {
  harness.effects = [];
  harness.invoke.mockReset().mockResolvedValue({ hits: [], cancelled: false });
});

function mount(query: string) {
  const useSearch = useFileSearch;
  useSearch("/repo", query, true, false);
  return harness.effects.map((effect) => effect());
}

it("abandons the warm-up and active search on close or root change", () => {
  const cleanups = mount("readme");
  expect(harness.invoke.mock.calls).toEqual([
    [
      "fs_search",
      expect.objectContaining({ query: "readme", requestKey: "palette-files" }),
    ],
    [
      "fs_warm_index",
      expect.objectContaining({
        root: "/repo",
        requestKey: "palette-files-warm",
      }),
    ],
  ]);
  for (const cleanup of cleanups) cleanup?.();
  expect(harness.invoke.mock.calls.slice(2)).toEqual([
    [
      "fs_search",
      expect.objectContaining({ query: "", requestKey: "palette-files" }),
    ],
    [
      "fs_warm_index",
      expect.objectContaining({
        root: "/repo",
        cancel: true,
        requestKey: "palette-files-warm",
      }),
    ],
  ]);
});

it("supersedes the active search when the query becomes empty", () => {
  mount("");
  expect(harness.invoke).toHaveBeenCalledWith(
    "fs_search",
    expect.objectContaining({ query: "", requestKey: "palette-files" }),
  );
});
