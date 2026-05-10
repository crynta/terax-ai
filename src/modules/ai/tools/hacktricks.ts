import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";

export function buildHacktricksTools() {
  return {
    hacktricks_search: tool({
      description: "Search the local HackTricks pentesting knowledge base. Use before and during every recon, enumeration, exploitation, privesc, and post-exploitation phase. Query any unfamiliar port, service, error, binary, or technique here first.",
      inputSchema: z.object({
        query: z.string().describe("Keyword or phrase, e.g. 'SMB null session', 'sudo NOPASSWD privesc', 'LFI to RCE Apache log poisoning'"),
        max_results: z.number().int().min(1).max(50).optional(),
      }),
      execute: async ({ query, max_results }) => {
        try {
          return await native.hacktricksSearch(query, max_results ?? 20);
        } catch (e) {
          return { error: String(e), hint: "Click 'Index HackTricks' in Terax settings to build the local index." };
        }
      },
    }),
  } as const;
}