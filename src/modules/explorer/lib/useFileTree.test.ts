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
