import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_MANUAL_SMOKE_SECTIONS,
  REQUIRED_MANUAL_SMOKE_TEXT,
  REQUIRED_RELEASE_READINESS_TEXT,
  checkPiReleaseDocs,
} from "./check-pi-release-docs.mjs";

async function writeFixture(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
}

const releaseReadinessDoc = REQUIRED_RELEASE_READINESS_TEXT.join("\n");
const manualSmokeDoc = [
  ...REQUIRED_MANUAL_SMOKE_SECTIONS,
  ...REQUIRED_MANUAL_SMOKE_TEXT,
].join("\n");

describe("checkPiReleaseDocs", () => {
  it("passes when release readiness and manual smoke docs cover required blockers", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-pi-release-docs-ok-"));
    await writeFixture(root, {
      "docs/pi-sidebar-release-readiness.md": releaseReadinessDoc,
      "docs/pi-sidebar-manual-smoke-report.md": manualSmokeDoc,
    });

    const result = await checkPiReleaseDocs(root);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails when release readiness loses a blocker", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-pi-release-docs-blocker-"));
    await writeFixture(root, {
      "docs/pi-sidebar-release-readiness.md": REQUIRED_RELEASE_READINESS_TEXT.filter(
        (line) => line !== "GitHub Actions and Linux e2e are not available",
      ).join("\n"),
      "docs/pi-sidebar-manual-smoke-report.md": manualSmokeDoc,
    });

    const result = await checkPiReleaseDocs(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "docs/pi-sidebar-release-readiness.md missing required release-readiness text: GitHub Actions and Linux e2e are not available",
        ),
      ]),
    );
  });

  it("fails when the manual smoke template loses a required flow", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-pi-release-docs-smoke-"));
    await writeFixture(root, {
      "docs/pi-sidebar-release-readiness.md": releaseReadinessDoc,
      "docs/pi-sidebar-manual-smoke-report.md": manualSmokeDoc.replace(
        "Tool approval deny path",
        "",
      ),
    });

    const result = await checkPiReleaseDocs(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "docs/pi-sidebar-manual-smoke-report.md missing required release-readiness text: Tool approval deny path",
        ),
      ]),
    );
  });
});
