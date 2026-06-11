import { tool } from "ai";
import { z } from "zod";
import { SUBAGENTS } from "../agents/registry";
import { runSubagent } from "../agents/runSubagent";
import { useChatStore } from "../store/chatStore";
import type { ToolContext } from "./context";

function getTypeKeys(): [string, ...string[]] {
  const keys = Object.keys(SUBAGENTS);
  return keys.length > 0 ? (keys as [string, ...string[]]) : ["explore"];
}

export function buildSubagentTools(ctx: ToolContext) {
  const typeKeys = getTypeKeys();

  return {
    run_subagent: tool({
      description: `Spawn an isolated subagent with its own restricted toolset and a fresh message history. Use when you need to delegate a self-contained read-only investigation (large search, code review, security audit) without polluting your own context. The subagent returns a single text summary; pick a 'type' that matches its job.

Types:
${typeKeys.map((k) => `- ${k}: ${SUBAGENTS[k]?.description ?? k}`).join("\n")}

Auto-executes (no approval) — subagents are read-only by design.`,
      inputSchema: z.object({
        type: z.enum(typeKeys),
        prompt: z
          .string()
          .describe(
            "Self-contained instruction. The subagent has no memory of prior conversation — include all relevant context.",
          ),
        description: z
          .string()
          .optional()
          .describe("Short label shown in the chat UI for the spawn card."),
      }),
      execute: async ({ type, prompt, description }) => {
        const { apiKeys, selectedModelId, patchAgentMeta } =
          useChatStore.getState();
        try {
          const r = await runSubagent({
            type,
            prompt,
            keys: apiKeys,
            modelId: selectedModelId,
            toolContext: ctx,
            onStep: (label) => patchAgentMeta({ step: label }),
          });
          return {
            type,
            description,
            summary: r.summary,
            stepCount: r.stepCount,
            durationMs: r.durationMs,
          };
        } catch (e) {
          return { error: String(e), type };
        }
      },
    }),
  } as const;
}
