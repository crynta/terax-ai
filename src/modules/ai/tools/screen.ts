import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./context";

export function buildScreenTools(_ctx: ToolContext) {
  return {
    capture_screenshot: tool({
      description:
        "Capture a screenshot of the user's screen. Returns the image dimensions and a base64-encoded PNG. Use this to see what the user sees.",
      inputSchema: z.object({
        focused_only: z
          .boolean()
          .optional()
          .describe(
            "If true, capture only the display containing the main window. Default: false.",
          ),
      }),
      execute: async ({ focused_only }) => {
        const { invoke } = await import("@tauri-apps/api/core");
        try {
          const result = await invoke<{
            width: number;
            height: number;
            base64: string;
          }>("capture_screen", { focusedOnly: focused_only ?? false });
          return {
            width: result.width,
            height: result.height,
            imageSizeKB: Math.round((result.base64.length * 3) / 4 / 1024),
            image: `data:image/png;base64,${result.base64}`,
          };
        } catch (e: unknown) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),
  } as const;
}
