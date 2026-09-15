import { homeRelativePath } from "@/lib/homeRelativePath";
import { expect, it } from "vitest";

it.each([
  ["C:\\Users\\me\\repo", "C:/Users/me/", "~/repo"],
  ["C:/Users/me", "C:\\Users\\me", "~"],
  ["/home/me/repo", "/home/me", "~/repo"],
  ["/home/other/repo", "/home/me", "/home/other/repo"],
  ["C:\\Users\\member", "C:/Users/me", "C:/Users/member"],
  ["D:\\repo", null, "D:/repo"],
  ["C:/Users/me/MyRepo", "c:/users/ME", "~/MyRepo"],
  ["c:\\users\\ME", "C:/Users/me", "~"],
  ["C:/Users/MEMBER", "c:/users/me", "C:/Users/MEMBER"],
  ["D:/Users/me/Repo", "c:/users/ME", "D:/Users/me/Repo"],
  ["/home/Me/Repo", "/home/me", "/home/Me/Repo"],
  ["\\\\Server\\Share\\ME\\Repo", "//server/share/me", "~/Repo"],
  ["//Server/Other/Repo", "//server/share", "//Server/Other/Repo"],
  ["c:/Repo", "C:/", "~/Repo"],
])("formats %s relative to %s", (path, home, expected) => {
  expect(homeRelativePath(path, home)).toBe(expected);
});
