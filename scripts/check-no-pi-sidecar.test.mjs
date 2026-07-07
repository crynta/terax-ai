import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkNoPiSidecar } from "./check-no-pi-sidecar.mjs";

async function writeFixture(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
  }
}

const healthyPackage = JSON.stringify({
  scripts: {
    "build:sidecars": "node scripts/build-speech-recognizer.mjs",
    build: "tsc && vite build",
  },
});

const healthyTauriConfig = JSON.stringify({
  build: {
    beforeBuildCommand: "pnpm build:sidecars && pnpm build",
  },
  bundle: {
    resources: {
      "resources/skills": "skills",
      "resources/sidecars": "sidecars",
    },
  },
});

describe("checkNoPiSidecar", () => {
  it("passes with only the speech recognizer sidecar path", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-no-pi-sidecar-ok-"));
    await writeFixture(root, {
      "package.json": healthyPackage,
      "pnpm-workspace.yaml": "packages: []\n",
      "src-tauri/tauri.conf.json": healthyTauriConfig,
      "src-tauri/sidecars/speech-recognizer/Package.swift": "// ok",
      "src-tauri/resources/sidecars/speech-recognizer/.gitkeep": "",
    });

    const result = await checkNoPiSidecar(root);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails when the deleted pi-host path returns", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-no-pi-sidecar-path-"));
    await writeFixture(root, {
      "package.json": healthyPackage,
      "pnpm-workspace.yaml": "packages: []\n",
      "src-tauri/tauri.conf.json": healthyTauriConfig,
      "sidecars/pi-host/host.js": "export {};",
    });

    const result = await checkNoPiSidecar(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("tracked Pi sidecar path is present: sidecars/pi-host/host.js"),
        expect.stringContaining("Pi sidecar directory is present: sidecars/pi-host"),
      ]),
    );
  });

  it("fails when package scripts rebuild the Pi host", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-no-pi-sidecar-package-"));
    await writeFixture(root, {
      "package.json": JSON.stringify({
        scripts: {
          "build:sidecars": "node scripts/build-pi-host-bundle.mjs",
        },
      }),
      "pnpm-workspace.yaml": "packages: []\n",
      "src-tauri/tauri.conf.json": healthyTauriConfig,
    });

    const result = await checkNoPiSidecar(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("package.json script build:sidecars reintroduces Pi sidecar text"),
      ]),
    );
  });

  it("fails when Tauri resources point at a Pi sidecar", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-no-pi-sidecar-tauri-"));
    await writeFixture(root, {
      "package.json": healthyPackage,
      "pnpm-workspace.yaml": "packages: []\n",
      "src-tauri/tauri.conf.json": JSON.stringify({
        bundle: {
          resources: {
            "../sidecars/pi-host/dist": "sidecars/pi-host",
          },
        },
      }),
    });

    const result = await checkNoPiSidecar(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("src-tauri/tauri.conf.json reintroduces Pi sidecar resource"),
      ]),
    );
  });
});
