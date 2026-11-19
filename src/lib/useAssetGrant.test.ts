import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  cursor: 0,
  effectDeps: [] as unknown[],
  cleanup: undefined as (() => void) | undefined,
  effect: undefined as (() => void | (() => void)) | undefined,
  invoke: vi.fn(),
  workspace: { kind: "local" },
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: harness.invoke,
  convertFileSrc: (path: string) => `http://asset.localhost/${path}`,
}));
vi.mock("@/modules/workspace", () => ({
  useWorkspaceEnvStore: () => harness.workspace,
  workspaceScopeKey: () => "local",
}));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const slot = harness.cursor++;
    if (!(slot in harness.states)) harness.states[slot] = initial;
    return [
      harness.states[slot],
      (value: unknown) => {
        harness.states[slot] =
          typeof value === "function" ? value(harness.states[slot]) : value;
      },
    ];
  },
  useCallback: (callback: unknown) => callback,
  useMemo: (compute: () => unknown) => compute(),
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    if (
      deps.some((value, index) => !Object.is(value, harness.effectDeps[index]))
    ) {
      harness.effect = effect;
      harness.effectDeps = deps;
    }
  },
}));
import { useAssetGrant } from "./useAssetGrant";

function render(path: string | null = "/repo/image.png") {
  harness.cursor = 0;
  const result = useAssetGrant(path);
  if (harness.effect) {
    harness.cleanup?.();
    const effect = harness.effect;
    harness.effect = undefined;
    harness.cleanup = effect() || undefined;
  }
  return result;
}
beforeEach(() => {
  harness.cleanup?.();
  harness.states = [];
  harness.effectDeps = [];
  harness.cleanup = undefined;
  harness.effect = undefined;
  harness.invoke.mockReset();
  harness.invoke.mockResolvedValue(undefined);
});

it("shows a rejected grant and permits a successful retry", async () => {
  harness.invoke.mockRejectedValueOnce(
    new Error("too many active media grants"),
  );
  expect(render().urlFor("/repo/image.png")).toBeUndefined();
  await vi.waitFor(() =>
    expect(render().error).toContain("too many active media grants"),
  );
  harness.invoke.mockResolvedValueOnce("fresh-token");
  render().retry();
  expect(render().error).toBeUndefined();
  await vi.waitFor(() =>
    expect(render().urlFor("/repo/image.png")).toContain("token=fresh-token"),
  );
});

it("revokes a grant returned after its view unmounts", async () => {
  let finish: (token: string) => void = () => {};
  harness.invoke.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  render();
  harness.cleanup?.();
  harness.cleanup = undefined;
  finish("late-token");
  await vi.waitFor(() =>
    expect(harness.invoke).toHaveBeenCalledWith("asset_revoke", {
      token: "late-token",
    }),
  );
});

it("does not request a grant for a non-media view", () => {
  render(null);
  expect(harness.invoke).not.toHaveBeenCalled();
});

it("permits the Windows media origin in both CSP directives", () => {
  const config = JSON.parse(
    readFileSync(
      new URL("../../src-tauri/tauri.conf.json", import.meta.url),
      "utf8",
    ),
  );
  for (const directive of ["img-src", "media-src"]) {
    const policy = config.app.security.csp
      .split(";")
      .find((value: string) => value.trim().startsWith(`${directive} `));
    expect(policy?.split(/\s+/)).toContain("http://asset.localhost");
  }
});
