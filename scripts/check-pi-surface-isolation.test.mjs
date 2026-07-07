import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPiSurfaceIsolation } from "./check-pi-surface-isolation.mjs";

async function writeFixture(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
  }
}

describe("checkPiSurfaceIsolation", () => {
  it("passes when legacy chat surfaces are reachable only through the fallback mini window", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-pi-surface-ok-"));
    await writeFixture(root, {
      "src/modules/ai/components/AiMiniWindow.tsx": `
import { AiChatView } from "./AiChat";
import { PlanDiffReview } from "./PlanDiffReview";
import { TodoStrip } from "./TodoStrip";
`,
      "src/modules/ai/components/AiChat.tsx": `
import { RenderedMessage } from "./AiChatMessage";
`,
      "src/app/AppWorkspaceSurface.tsx": `
import { AiMiniWindow } from "@/modules/ai/components/lazy";
`,
    });

    const result = await checkPiSurfaceIsolation(root);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails when a production surface imports AiChat directly", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-pi-surface-bad-chat-"));
    await writeFixture(root, {
      "src/app/AppWorkspaceSurface.tsx": `
import { AiChatView } from "@/modules/ai/components/AiChat";
`,
    });

    const result = await checkPiSurfaceIsolation(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("imports legacy AI surface AiChat"),
      ]),
    );
  });

  it("allows tests to import legacy surface components", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-pi-surface-test-"));
    await writeFixture(root, {
      "src/modules/ai/components/AiChat.test.tsx": `
import { AiChatView } from "./AiChat";
`,
      "src/modules/ai/components/TodoStrip.test.tsx": `
import { TodoStrip } from "./TodoStrip";
`,
    });

    const result = await checkPiSurfaceIsolation(root);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails when plan or todo affordances escape the fallback mini window", async () => {
    const root = await mkdtemp(join(tmpdir(), "terax-pi-surface-bad-affordance-"));
    await writeFixture(root, {
      "src/modules/pi/components/PiTranscript.tsx": `
import { PlanDiffReview } from "@/modules/ai/components/PlanDiffReview";
import { TodoStrip } from "@/modules/ai/components/TodoStrip";
`,
    });

    const result = await checkPiSurfaceIsolation(root);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("imports legacy AI surface PlanDiffReview"),
        expect.stringContaining("imports legacy AI surface TodoStrip"),
      ]),
    );
  });
});
