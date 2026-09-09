import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const temporary = await mkdtemp(join(tmpdir(), "terax-core-profile-"));
const directories = [resolve("packages/ghostty-core/adapted")];
if (process.env.TERAX_PROFILE_BASELINE)
  directories.unshift(resolve(process.env.TERAX_PROFILE_BASELINE));
if (process.env.TERAX_PROFILE_REVERSE === "1") directories.reverse();
let report;
const results = [];
try {
  for (const directory of directories) {
    for (const artifact of ["ghostty-vt.wasm", "ghostty-vt-scalar.wasm"]) {
      const path = join(temporary, "sample.json");
      const child = spawnSync(
        "pnpm",
        [
          "exec",
          "vitest",
          "run",
          "--config",
          "scripts/ghostty-profile.config.ts",
        ],
        {
          stdio: "inherit",
          timeout: 240_000,
          shell: process.platform === "win32",
          env: {
            ...process.env,
            TERAX_PROFILE_CORE_DIR: directory,
            TERAX_PROFILE_ARTIFACT: artifact,
            TERAX_PROFILE_REPORT: path,
          },
        },
      );
      if (child.error) throw child.error;
      if (child.status !== 0)
        throw new Error(
          `Core profiling failed for ${artifact}: ${child.status}`,
        );
      report = JSON.parse(await readFile(path, "utf8"));
      results.push(...report.results);
    }
  }
  report = {
    ...report,
    isolation: "Fresh Node process per artifact and revision",
    results,
  };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (process.env.TERAX_PROFILE_REPORT)
    await writeFile(process.env.TERAX_PROFILE_REPORT, output);
  else console.info(output);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
