import type { SpaceMeta } from "@/modules/spaces";
import type { EditorTab } from "@/modules/tabs";
import { describe, expect, it } from "vitest";
import {
  hasOpenEditorAtPath,
  projectRenamedPath,
  spaceIdsForWorkspace,
} from "./explorerPathMutations";

function editor(id: number, path: string, spaceId = "local"): EditorTab {
  return {
    id,
    kind: "editor",
    title: path,
    path,
    dirty: false,
    preview: false,
    spaceId,
  };
}

function space(id: string, kind: "local" | "wsl", distro?: string): SpaceMeta {
  return {
    id,
    name: id,
    root: null,
    env: kind === "local" ? { kind } : { kind, distro: distro ?? "Ubuntu" },
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("explorer path mutations", () => {
  it("projects directory renames in operation order", () => {
    expect(
      projectRenamedPath("/repo/src/deep/a.ts", [
        { from: "/repo/src", to: "/repo/lib", replaced: false },
        { from: "/repo/lib", to: "/repo/pkg", replaced: false },
      ]),
    ).toBe("/repo/pkg/deep/a.ts");
  });

  it("blocks replacement when an earlier batch move projects an editor onto the target", () => {
    const tabs = [editor(1, "/repo/a.ts")];
    const completed = [
      {
        from: "/repo/a.ts",
        to: "/repo/dest/a.ts",
        replaced: false,
      },
    ];
    expect(
      hasOpenEditorAtPath(
        tabs,
        "/repo/dest/a.ts",
        completed,
        new Set(["local"]),
      ),
    ).toBe(true);
  });

  it("isolates equal WSL paths belonging to different distros", () => {
    const spaces = [
      space("ubuntu", "wsl", "Ubuntu"),
      space("debian", "wsl", "Debian"),
    ];
    const ubuntu = spaceIdsForWorkspace(spaces, "wsl:Ubuntu");
    expect(
      hasOpenEditorAtPath(
        [editor(1, "/home/me/a.ts", "debian")],
        "/home/me/a.ts",
        [],
        ubuntu,
      ),
    ).toBe(false);
  });
});
