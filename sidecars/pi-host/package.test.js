import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_PATH = fileURLToPath(new URL("./package.json", import.meta.url));

describe("Pi host package", () => {
  it("deploys only runtime entry files from the package root", async () => {
    const manifest = JSON.parse(await readFile(PACKAGE_PATH, "utf8"));

    expect(manifest.files).toEqual([
      "host.js",
      "protocol.js",
      "provider-config.js",
      "session-errors.js",
      "sessions.js",
      "package.json",
    ]);
  });

  it("keeps Node dependencies scoped to Pi packages", async () => {
    const manifest = JSON.parse(await readFile(PACKAGE_PATH, "utf8"));
    const dependencyNames = Object.keys(manifest.dependencies ?? {});

    expect(dependencyNames.length).toBeGreaterThan(0);
    expect(dependencyNames).toEqual(
      dependencyNames.filter((name) => name.startsWith("@earendil-works/pi-")),
    );
  });
});
