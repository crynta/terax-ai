import { tool } from "ai";
import { z } from "zod";
import { areOpenClickyAiToolsEnabled } from "@/modules/ai/lib/featureGates";
import type { ToolContext } from "./context";

export function build3DTools(_ctx: ToolContext) {
  return {
    generate_3d_model: tool({
      description:
        "Generate a 3D model from a text description using the Tripo API. Returns a GLB model URL and thumbnail URL. The model takes ~30-120 seconds to generate.",
      inputSchema: z.object({
        prompt: z
          .string()
          .describe("A description of the 3D model to generate."),
      }),
      execute: async ({ prompt }) => {
        if (!areOpenClickyAiToolsEnabled()) {
          return {
            error: "3D generation is experimental and disabled for this build.",
          };
        }
        const { invoke } = await import("@tauri-apps/api/core");
        try {
          const result = await invoke<{
            modelUrl: string;
            thumbnailUrl: string;
          }>("generate_3d_model", { prompt });
          return {
            modelUrl: result.modelUrl,
            thumbnailUrl: result.thumbnailUrl,
            message: `3D model generated. GLB URL: ${result.modelUrl}`,
          };
        } catch (e: unknown) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),
  } as const;
}
