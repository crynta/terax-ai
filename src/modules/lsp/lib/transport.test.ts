import { beforeEach, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, Channel: class {} }));
vi.mock("@/modules/workspace", () => ({
  currentWorkspaceEnv: () => ({ kind: "local" }),
}));
import { TauriLspTransport } from "./transport";

beforeEach(() => invoke.mockReset());

it("deduplicates shutdown and waits for native kill completion", async () => {
  let killed!: () => void;
  invoke.mockResolvedValueOnce(42).mockReturnValueOnce(
    new Promise<void>((r) => {
      killed = r;
    }),
  );
  const transport = new TauriLspTransport();
  await transport.start({ command: "test", args: [], root: "/root" });
  const stopping = transport.stop();
  expect(transport.stop()).toBe(stopping);
  let done = false;
  void stopping.then(() => {
    done = true;
  });
  await Promise.resolve();
  expect(done).toBe(false);
  expect(invoke).toHaveBeenLastCalledWith("lsp_kill", { id: 42 });
  killed();
  await stopping;
  expect(done).toBe(true);
  await transport.stop();
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("keeps the process id available to retry a failed kill", async () => {
  invoke
    .mockResolvedValueOnce(42)
    .mockRejectedValueOnce(new Error("IPC failed"))
    .mockResolvedValueOnce(undefined);
  const transport = new TauriLspTransport();
  await transport.start({ command: "test", args: [], root: "/root" });
  await expect(transport.stop()).rejects.toThrow("IPC failed");
  await transport.stop();
  expect(invoke.mock.calls.slice(1)).toEqual([
    ["lsp_kill", { id: 42 }],
    ["lsp_kill", { id: 42 }],
  ]);
});
