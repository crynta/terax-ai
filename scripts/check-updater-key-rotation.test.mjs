import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_UPDATE_ENDPOINT,
  EXPECTED_UPDATER_KEY_ID,
  OLD_UPDATER_KEY_ID,
  REQUIRED_UPDATER_DOC_TEXT,
  checkUpdaterKeyRotation,
} from "./check-updater-key-rotation.mjs";

function encodedPubkey(keyId) {
  return Buffer.from(`untrusted comment: minisign public key: ${keyId}\nRWQfixture\n`, "utf8").toString("base64");
}

function healthyTauriConfig() {
  return JSON.stringify({
    plugins: {
      updater: {
        pubkey: encodedPubkey(EXPECTED_UPDATER_KEY_ID),
        endpoints: [EXPECTED_UPDATE_ENDPOINT],
      },
    },
  });
}

function healthyReleaseWorkflow() {
  return [
    "name: Release",
    "jobs:",
    "  publish-tauri:",
    "    steps:",
    "      - uses: tauri-apps/tauri-action@v0",
    "        env:",
    "          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}",
    "          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}",
  ].join("\n");
}

function healthyUpdaterDocs() {
  return REQUIRED_UPDATER_DOC_TEXT.join("\n");
}

async function writeFixture(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
}

describe("checkUpdaterKeyRotation", () => {
  it("passes when the embedded pubkey, release workflow, and cutover docs match the rotation", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-updater-key-ok-"));
    await writeFixture(root, {
      "src-tauri/tauri.conf.json": healthyTauriConfig(),
      ".github/workflows/release.yml": healthyReleaseWorkflow(),
      "docs/updater-key-rotation.md": healthyUpdaterDocs(),
    });

    const result = await checkUpdaterKeyRotation(root);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.decodedPubkey).toContain(EXPECTED_UPDATER_KEY_ID);
    expect(result.workflowAction).toBe("tauri-apps/tauri-action@v0");
  });

  it("fails when the embedded updater pubkey still uses the old key id", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-updater-key-old-"));
    await writeFixture(root, {
      "src-tauri/tauri.conf.json": JSON.stringify({
        plugins: {
          updater: {
            pubkey: encodedPubkey(OLD_UPDATER_KEY_ID),
            endpoints: [EXPECTED_UPDATE_ENDPOINT],
          },
        },
      }),
      ".github/workflows/release.yml": healthyReleaseWorkflow(),
      "docs/updater-key-rotation.md": healthyUpdaterDocs(),
    });

    const result = await checkUpdaterKeyRotation(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`does not decode to expected key id ${EXPECTED_UPDATER_KEY_ID}`),
        expect.stringContaining(`still contains old key id ${OLD_UPDATER_KEY_ID}`),
      ]),
    );
  });

  it("fails when release signing secrets are not passed to tauri-action", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-updater-key-workflow-"));
    await writeFixture(root, {
      "src-tauri/tauri.conf.json": healthyTauriConfig(),
      ".github/workflows/release.yml": [
        "name: Release",
        "jobs:",
        "  publish-tauri:",
        "    steps:",
        "      - uses: tauri-apps/tauri-action@v0",
      ].join("\n"),
      "docs/updater-key-rotation.md": healthyUpdaterDocs(),
    });

    const result = await checkUpdaterKeyRotation(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("TAURI_SIGNING_PRIVATE_KEY"),
        expect.stringContaining("TAURI_SIGNING_PRIVATE_KEY_PASSWORD"),
      ]),
    );
  });

  it("fails when the updater cutover docs lose the fallback release-note path", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-updater-key-docs-"));
    await writeFixture(root, {
      "src-tauri/tauri.conf.json": healthyTauriConfig(),
      ".github/workflows/release.yml": healthyReleaseWorkflow(),
      "docs/updater-key-rotation.md": healthyUpdaterDocs().replace(
        "Fallback reinstall-announcement path",
        "",
      ),
    });

    const result = await checkUpdaterKeyRotation(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "docs/updater-key-rotation.md is missing required rotation note: Fallback reinstall-announcement path",
        ),
      ]),
    );
  });
});
