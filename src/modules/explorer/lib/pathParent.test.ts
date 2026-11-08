import { expect, it } from "vitest";
import { parentDir } from "./pathParent";

it.each([
  ["C:/README.md", "C:/"],
  ["D:\\README.md", "D:\\"],
  ["\\\\?\\D:\\README.md", "\\\\?\\D:\\"],
  ["C:/repo/README.md", "C:/repo"],
  ["\\\\server\\share\\README.md", "\\\\server\\share"],
  ["//server/share\\README.md", "//server/share"],
  ["/README.md", "/"],
  ["/repo/file\\name.md", "/repo"],
])("finds the parent directory of %s", (path, parent) => {
  expect(parentDir(path)).toBe(parent);
});

it("uses the supplied fallback for a path with no directory", () => {
  expect(parentDir("README.md", "C:/")).toBe("C:/");
});
