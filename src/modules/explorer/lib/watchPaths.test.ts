import type { WorkspaceEnv } from "@/modules/workspace";
import { describe, expect, it } from "vitest";
import { toWorkspacePath } from "./watchPaths";

const wsl: WorkspaceEnv = { kind: "wsl", distro: "FedoraLinux-43" };
const local: WorkspaceEnv = { kind: "local" };

describe("toWorkspacePath", () => {
  it("maps the wsl.localhost share to the workspace spelling", () => {
    expect(
      toWorkspacePath(
        "//wsl.localhost/FedoraLinux-43/home/ngash/src/a.ts",
        wsl,
      ),
    ).toBe("/home/ngash/src/a.ts");
  });

  it("maps the legacy wsl$ share too", () => {
    expect(toWorkspacePath("//wsl$/FedoraLinux-43/home/ngash", wsl)).toBe(
      "/home/ngash",
    );
  });

  it("matches the share and distro case-insensitively", () => {
    expect(
      toWorkspacePath("//WSL.LOCALHOST/fedoralinux-43/home/ngash/a.ts", wsl),
    ).toBe("/home/ngash/a.ts");
    expect(toWorkspacePath("//Wsl$/FEDORALINUX-43/home", wsl)).toBe("/home");
  });

  it("leaves a different distro untouched", () => {
    const other = "//wsl.localhost/Ubuntu/home/ngash/a.ts";
    expect(toWorkspacePath(other, wsl)).toBe(other);
    expect(toWorkspacePath("//wsl$/Ubuntu/home", wsl)).toBe(
      "//wsl$/Ubuntu/home",
    );
  });

  it("maps a host drive to its drvfs mount", () => {
    expect(toWorkspacePath("C:/Users/Chomz/project/a.ts", wsl)).toBe(
      "/mnt/c/Users/Chomz/project/a.ts",
    );
    expect(toWorkspacePath("d:/data", wsl)).toBe("/mnt/d/data");
  });

  it("leaves a local workspace untouched", () => {
    expect(toWorkspacePath("C:/Users/Chomz/project", local)).toBe(
      "C:/Users/Chomz/project",
    );
    expect(toWorkspacePath("//wsl.localhost/Ubuntu/home", local)).toBe(
      "//wsl.localhost/Ubuntu/home",
    );
  });

  it("returns a path that matches nothing verbatim", () => {
    expect(toWorkspacePath("/home/ngash/a.ts", wsl)).toBe("/home/ngash/a.ts");
    expect(toWorkspacePath("relative/a.ts", wsl)).toBe("relative/a.ts");
    expect(toWorkspacePath("", wsl)).toBe("");
  });

  it("tolerates the backslash spelling", () => {
    expect(
      toWorkspacePath(
        "\\\\wsl.localhost\\FedoraLinux-43\\home\\ngash\\a.ts",
        wsl,
      ),
    ).toBe("/home/ngash/a.ts");
    expect(toWorkspacePath("\\\\wsl$\\FedoraLinux-43\\home", wsl)).toBe(
      "/home",
    );
    expect(toWorkspacePath("C:\\Users\\Chomz\\a.ts", wsl)).toBe(
      "/mnt/c/Users/Chomz/a.ts",
    );
  });

  it("does not invent a doubled or trailing slash", () => {
    expect(toWorkspacePath("//wsl.localhost/FedoraLinux-43/home/", wsl)).toBe(
      "/home/",
    );
    expect(toWorkspacePath("C:/Users/Chomz/", wsl)).toBe("/mnt/c/Users/Chomz/");
    expect(toWorkspacePath("C:/Users/Chomz", wsl)).toBe("/mnt/c/Users/Chomz");
  });
});
