import { describe, expect, it, vi } from "vitest";
import { workspaceScopeKey } from "@/modules/workspace";
import { validateSpaceRoot } from "@/modules/spaces/lib/rootValidation";

describe("validateSpaceRoot", () => {
  it("canonicalizes, verifies a directory, and authorizes with the same env", async () => {
    const env = { kind: "wsl", distro: "Ubuntu" } as const;
    const calls: string[] = [];
    const root = await validateSpaceRoot("/repo/../repo", env, {
      canonicalize: async (path, actualEnv) => {
        calls.push(`canonicalize:${path}:${workspaceScopeKey(actualEnv)}`);
        return "/repo";
      },
      stat: async (path, actualEnv) => {
        calls.push(`stat:${path}:${workspaceScopeKey(actualEnv)}`);
        return { size: 0, mtime: 0, kind: "dir" };
      },
      authorize: async (path, actualEnv) => {
        calls.push(`authorize:${path}:${workspaceScopeKey(actualEnv)}`);
      },
    });

    expect(root).toBe("/repo");
    expect(calls).toEqual([
      "canonicalize:/repo/../repo:wsl:Ubuntu",
      "stat:/repo:wsl:Ubuntu",
      "authorize:/repo:wsl:Ubuntu",
    ]);
  });

  it("rejects non-directory roots before authorization", async () => {
    const authorize = vi.fn(async () => {});

    await expect(
      validateSpaceRoot(
        "/file",
        { kind: "local" },
        {
          canonicalize: async () => "/file",
          stat: async () => ({ size: 1, mtime: 0, kind: "file" }),
          authorize,
        },
      ),
    ).rejects.toThrow("Space root must be a directory.");
    expect(authorize).not.toHaveBeenCalled();
  });

  it("preserves backslashes in canonical Unix and WSL directory names", async () => {
    const canonical = "/repo/dir\\name";
    const stat = vi.fn(async () => ({
      size: 0,
      mtime: 0,
      kind: "dir" as const,
    }));
    const authorize = vi.fn(async () => {});

    const root = await validateSpaceRoot(
      canonical,
      { kind: "wsl", distro: "Ubuntu" },
      {
        canonicalize: async () => canonical,
        stat,
        authorize,
      },
    );

    expect(root).toBe(canonical);
    expect(stat).toHaveBeenCalledWith(canonical, {
      kind: "wsl",
      distro: "Ubuntu",
    });
    expect(authorize).toHaveBeenCalledWith(canonical, {
      kind: "wsl",
      distro: "Ubuntu",
    });
  });
});
