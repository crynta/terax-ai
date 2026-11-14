import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));
const target = `terax-test-${process.pid}`;
const sidecar = join(root, "src-tauri", "binaries", `terax-cli-${target}`);

describe.skipIf(process.platform === "win32")("build-cli", () => {
  it("copies the CLI from Cargo's configured target dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "terax-build-cli-"));
    const targetDir = join(dir, "shared-target");
    const out = `${targetDir}/${target}/debug`;
    // Fake cargo: reports a target dir outside src-tauri and builds into it.
    writeFileSync(
      join(dir, "cargo"),
      `#!/bin/sh
if [ "$1" = metadata ]; then printf '{"target_directory":"%s"}' "${targetDir}"; exit 0; fi
mkdir -p "${out}" && echo cli > "${out}/terax-cli"
`,
    );
    chmodSync(join(dir, "cargo"), 0o755);
    try {
      execFileSync(process.execPath, [join(root, "scripts/build-cli.mjs")], {
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          TERAX_CLI_TARGET: target,
        },
        stdio: "pipe",
      });
      expect(readFileSync(sidecar, "utf8")).toBe("cli\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(sidecar, { force: true });
    }
  });
});
