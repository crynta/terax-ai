import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./context";

export function buildOverlayTools(_ctx: ToolContext) {
  return {
    annotate_screen: tool({
      description:
        "Draw annotations (rectangles, circles, arrows, text, scribbles) on a transparent overlay on the user's screen. Use this to highlight UI elements, point at things, or add visual labels.",
      inputSchema: z.object({
        items: z
          .array(
            z.union([
              z.object({
                type: z.literal("rect"),
                x: z.number(),
                y: z.number(),
                width: z.number(),
                height: z.number(),
                color: z.string().optional(),
                strokeWidth: z.number().optional(),
              }),
              z.object({
                type: z.literal("circle"),
                cx: z.number(),
                cy: z.number(),
                radius: z.number(),
                color: z.string().optional(),
                strokeWidth: z.number().optional(),
              }),
              z.object({
                type: z.literal("arrow"),
                x1: z.number(),
                y1: z.number(),
                x2: z.number(),
                y2: z.number(),
                color: z.string().optional(),
                strokeWidth: z.number().optional(),
              }),
              z.object({
                type: z.literal("text"),
                x: z.number(),
                y: z.number(),
                content: z.string(),
                fontSize: z.number().optional(),
                color: z.string().optional(),
              }),
              z.object({
                type: z.literal("scribble"),
                points: z.array(z.tuple([z.number(), z.number()])),
                color: z.string().optional(),
                strokeWidth: z.number().optional(),
              }),
            ]),
          )
          .describe("Array of annotation items to draw on the overlay"),
      }),
      execute: async ({ items }) => {
        const { invoke } = await import("@tauri-apps/api/core");
        try {
          await invoke("overlay_show");
          await invoke("overlay_draw", { items });
          return { success: true, count: items.length };
        } catch (e: unknown) {
          return {
            success: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
    }),
    clear_annotations: tool({
      description: "Clear all annotations from the screen overlay.",
      inputSchema: z.object({}),
      execute: async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        try {
          await invoke("overlay_clear");
          await invoke("overlay_hide");
          return { success: true };
        } catch (e: unknown) {
          return {
            success: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
    }),
  } as const;
}
