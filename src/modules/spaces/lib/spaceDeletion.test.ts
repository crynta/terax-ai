import { describe, expect, it, vi } from "vitest";
import { deleteSpaceAfterActivation } from "./spaceDeletion";
import { createSpaceController } from "./spaceController";

const wsl = { kind: "wsl" as const, distro: "Ubuntu" };

describe("deleteSpaceAfterActivation", () => {
  it("preserves an active Space and its tabs when fallback preparation fails", async () => {
    const remove = vi.fn();
    const controller = createSpaceController({
      getSpace: (id) =>
        id === "fallback"
          ? {
              id,
              name: "fallback",
              root: "/fallback",
              env: wsl,
              createdAt: 0,
              updatedAt: 0,
            }
          : null,
      currentEnv: () => ({ kind: "local" }),
      validateRoot: async (path) => path,
      prepareEnv: async () => {
        throw new Error("WSL unavailable");
      },
      applyEnv: () => {},
      commitActive: () => {},
      createMeta: () => {
        throw new Error("not used");
      },
      createTerminal: () => 1,
      setRoot: () => {},
      reportError: () => {},
    });

    await expect(
      deleteSpaceAfterActivation({
        isActive: true,
        activate: () => controller.activate({ spaceId: "fallback" }),
        remove,
      }),
    ).resolves.toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes an inactive Space without activation", async () => {
    const activate = vi.fn(async () => true);
    const remove = vi.fn();

    await expect(
      deleteSpaceAfterActivation({ isActive: false, activate, remove }),
    ).resolves.toBe(true);
    expect(activate).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledOnce();
  });
});
