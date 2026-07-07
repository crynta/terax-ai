import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkTauriInvokes } from "./check-tauri-invokes.mjs";

async function writeFixture(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
  }
}

function libWithHandlers(handlers) {
  return `
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
${handlers}
        ])
        .run(tauri::generate_context!());
}
`;
}

const emptyRules = {
  dynamicInvokeCommands: [],
  featureGatedInvokes: new Map(),
};

describe("checkTauriInvokes", () => {
  it("passes for registered direct and documented feature gated invokes", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-tauri-invokes-ok-"));
    await writeFixture(root, {
      "src/app.ts": `
import { invoke } from "@tauri-apps/api/core";
invoke("fs_read_file", {});
invoke("overlay_show", {});
`,
      "src-tauri/src/lib.rs": libWithHandlers(`            fs::file::fs_read_file,
            #[cfg(feature = "openclicky")]
            overlay::overlay_show,`),
    });

    const result = await checkTauriInvokes(root, {
      dynamicInvokeCommands: [],
      featureGatedInvokes: new Map([["overlay_show", "openclicky"]]),
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.invokedCommands).toBe(2);
  });

  it("fails when a frontend invoke has no Rust handler", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-tauri-invokes-missing-"));
    await writeFixture(root, {
      "src/app.ts": `
import { invoke } from "@tauri-apps/api/core";
invoke("fs_write_file", {});
`,
      "src-tauri/src/lib.rs": libWithHandlers("            fs::file::fs_read_file,"),
    });

    const result = await checkTauriInvokes(root, emptyRules);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("invokes fs_write_file"),
        expect.stringContaining("does not register it"),
      ]),
    );
  });

  it("fails when a feature gated invoke is not documented", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-tauri-invokes-feature-"));
    await writeFixture(root, {
      "src/app.ts": `
import { invoke } from "@tauri-apps/api/core";
invoke("overlay_show", {});
`,
      "src-tauri/src/lib.rs": libWithHandlers(`            #[cfg(feature = "openclicky")]
            overlay::overlay_show,`),
    });

    const result = await checkTauriInvokes(root, emptyRules);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "invokes feature gated command overlay_show without an allowlist entry for openclicky",
        ),
      ]),
    );
  });
});
