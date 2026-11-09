import { expect, it } from "vitest";
import { planExplorerRename, removedChildDirectories } from "./useFileTree";

it.each(["C:/", "/"])(
  "keeps %s watched when a cached child disappears",
  (root) => {
    const removed = `${root}removed`;
    const live = `${root}live`;
    expect(
      removedChildDirectories(
        root,
        [root, removed, `${removed}/nested`, live],
        new Set([live]),
      ),
    ).toEqual([removed]);
  },
);

it("compares the full filename when renaming at a Windows drive root", () => {
  expect(planExplorerRename("C:/README.md", "README.md")).toBeNull();
  expect(planExplorerRename("C:/README.md", "EADME.md")).toEqual({
    parent: "C:/",
    to: "C:/EADME.md",
  });
});

it.each([
  ["D:\\README.md", "README.md", "D:\\", "D:\\renamed.md"],
  ["/repo/a\\b.md", "a\\b.md", "/repo", "/repo/renamed.md"],
])(
  "keeps the filename and parent rules aligned for %s",
  (path, basename, parent, to) => {
    expect(planExplorerRename(path, basename)).toBeNull();
    expect(planExplorerRename(path, "renamed.md")).toEqual({ parent, to });
  },
);
