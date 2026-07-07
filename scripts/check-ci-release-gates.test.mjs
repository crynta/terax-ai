import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_CI_RELEASE_GATES, checkCiReleaseGates } from "./check-ci-release-gates.mjs";

async function writeWorkflow(root, text) {
  const path = join(root, ".github/workflows/ci.yml");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

const healthyWorkflow = REQUIRED_CI_RELEASE_GATES.map((gate) => gate.text).join("\n");

describe("checkCiReleaseGates", () => {
  it("passes when CI contains every required release gate", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-ci-gates-ok-"));
    await writeWorkflow(root, healthyWorkflow);

    const result = await checkCiReleaseGates(root);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails when the Linux e2e gate is removed", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-ci-gates-e2e-"));
    await writeWorkflow(root, healthyWorkflow.replace("xvfb-run -a pnpm e2e", "pnpm e2e"));

    const result = await checkCiReleaseGates(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          ".github/workflows/ci.yml is missing required Linux e2e gate: xvfb-run -a pnpm e2e",
        ),
      ]),
    );
  });

  it("fails when release-only frontend gates are removed", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-ci-gates-frontend-"));
    await writeWorkflow(
      root,
      healthyWorkflow
        .replace("pnpm check:updater-key-rotation", "")
        .replace("pnpm check:bundle-size", ""),
    );

    const result = await checkCiReleaseGates(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("missing required updater key rotation gate"),
        expect.stringContaining("missing required bundle-size budget gate"),
      ]),
    );
  });

  it("fails when Rust feature gates are removed", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-ci-gates-rust-features-"));
    await writeWorkflow(
      root,
      healthyWorkflow
        .replace("cargo clippy --all-targets --locked --features workflow -- -D warnings", "")
        .replace("cargo nextest run --locked --features openclicky --retries 2", ""),
    );

    const result = await checkCiReleaseGates(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("missing required Rust workflow feature clippy gate"),
        expect.stringContaining("missing required Rust openclicky feature nextest gate"),
      ]),
    );
  });
});
