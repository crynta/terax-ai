import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_PATH = fileURLToPath(new URL("./package.json", import.meta.url));

describe("Pi host package", () => {
  it("deploys only runtime entry files from the package root", async () => {
    const manifest = JSON.parse(await readFile(PACKAGE_PATH, "utf8"));

    expect(manifest.files).toEqual(["host.js", "protocol.js", "package.json"]);
  });
});
