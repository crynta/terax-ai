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

  it("fails when deleted sidecar routing flags return to source", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-no-pi-sidecar-source-"));
    await writeFixture(root, {
      "package.json": healthyPackage,
      "pnpm-workspace.yaml": "packages: []\n",
      "src-tauri/tauri.conf.json": healthyTauriConfig,
      "src/modules/pi/lib/pi-session-backend.ts": "const USE_WEBVIEW_AGENT = true; const sidecarBackend = {};",
    });

    const result = await checkNoPiSidecar(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("src/modules/pi/lib/pi-session-backend.ts reintroduces deleted Pi sidecar/webview routing flag: USE_WEBVIEW_AGENT"),
        expect.stringContaining("src/modules/pi/lib/pi-session-backend.ts reintroduces deleted Pi sidecar/webview routing flag: sidecarBackend"),
      ]),
    );
  });

  it("fails when a stale sidecar-era doc lacks a historical banner", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-no-pi-sidecar-doc-"));
    await writeFixture(root, {
      "package.json": healthyPackage,
      "pnpm-workspace.yaml": "packages: []\n",
      "src-tauri/tauri.conf.json": healthyTauriConfig,
      "docs/old-plan.md": "# Old plan\n\nRebuild sidecars/pi-host before release.",
    });

    const result = await checkNoPiSidecar(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("docs/old-plan.md mentions the deleted Pi sidecar"),
      ]),
    );
  });

  it("allows historical sidecar-era docs and current release docs", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-no-pi-sidecar-doc-ok-"));
    await writeFixture(root, {
      "package.json": healthyPackage,
      "pnpm-workspace.yaml": "packages: []\n",
      "src-tauri/tauri.conf.json": healthyTauriConfig,
      "docs/old-plan.md":
        "# Old plan\n\n> Status: historical only. Use docs/pi-runtime.md for current truth.\n\nThe old sidecars/pi-host path existed here.",
      "docs/pi-runtime.md": "# Pi runtime\n\nNo Node Pi sidecar or sidecars/pi-host runtime ships now.",
    });

    const result = await checkNoPiSidecar(root);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
