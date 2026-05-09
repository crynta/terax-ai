import { tool } from "ai";
import { z } from "zod";
import { native } from "../lib/native";
import { checkWritable } from "../lib/security";
import { newQueuedEditId, usePlanStore } from "../store/planStore";
import { resolvePath, type ToolContext } from "./context";

type EditResult =
  | { ok: true; replacements: number; bytesWritten: number; path: string }
  | { error: string; path: string };

async function applyEdits(
  abs: string,
  edits: { old_string: string; new_string: string; replace_all?: boolean }[],
  kind: "edit" | "multi_edit",
): Promise<EditResult> {
  const r = await native.readFile(abs);
  if (r.kind === "binary") return { error: "binary file refused", path: abs };
  if (r.kind === "toolarge")
    return { error: `file too large (${r.size} bytes)`, path: abs };

  const original = r.content;
  let content = original;
  let totalReplacements = 0;

  for (const e of edits) {
    if (e.old_string === e.new_string) {
      return {
        error: "old_string and new_string are identical",
        path: abs,
      };
    }
    if (e.old_string.length === 0) {
      return { error: "old_string cannot be empty", path: abs };
    }
    if (e.replace_all) {
      const before = content;
      content = content.split(e.old_string).join(e.new_string);
      const occurrences =
        (before.length - content.length) /
          (e.old_string.length - e.new_string.length || 1) || 0;
      // Recover count via direct search to avoid divide-by-zero edge cases.
      let n = 0;
      let i = 0;
      while ((i = before.indexOf(e.old_string, i)) !== -1) {
        n++;
        i += e.old_string.length;
      }
      if (n === 0) {
        return {
          error: `old_string not found: ${JSON.stringify(e.old_string.slice(0, 80))}`,
          path: abs,
        };
      }
      totalReplacements += n;
      void occurrences;
    } else {
      const first = content.indexOf(e.old_string);
      if (first === -1) {
        return {
          error: `old_string not found: ${JSON.stringify(e.old_string.slice(0, 80))}`,
          path: abs,
        };
      }
      const second = content.indexOf(e.old_string, first + 1);
      if (second !== -1) {
        return {
          error:
            "old_string is not unique. Provide more surrounding context, or set replace_all=true.",
          path: abs,
        };
      }
      content =
        content.slice(0, first) +
        e.new_string +
        content.slice(first + e.old_string.length);
      totalReplacements += 1;
    }
  }

  if (usePlanStore.getState().active) {
    usePlanStore.getState().enqueue({
      id: newQueuedEditId(),
      kind,
      path: abs,
      originalContent: original,
      proposedContent: content,
      isNewFile: false,
    });
    return {
      ok: true,
      replacements: totalReplacements,
      bytesWritten: content.length,
      path: abs,
    };
  }

  try {
    await native.writeFile(abs, content);
    return {
      ok: true,
      replacements: totalReplacements,
      bytesWritten: content.length,
      path: abs,
    };
  } catch (err) {
    return { error: String(err), path: abs };
  }
}

export function buildEditTools(ctx: ToolContext) {
  return {
    edit: tool({
      description:
        "Replace an exact string in a file. Requires read_file on this path first in the current session — this prevents blind edits. `old_string` must be unique in the file unless `replace_all: true`. Asks for user approval before writing.",
      inputSchema: z.object({
        path: z.string(),
        old_string: z
          .string()
          .describe(
            "Exact substring to replace. Must be unique unless replace_all.",
          ),
        new_string: z.string().describe("Replacement substring."),
        replace_all: z.boolean().optional(),
      }),
      needsApproval: true,
      execute: async ({ path, old_string, new_string, replace_all }) => {
        const abs = resolvePath(path, ctx.getCwd());
        const safety = checkWritable(abs);
        if (!safety.ok) return { error: safety.reason, path: abs };
        if (!ctx.readCache.has(abs)) {
          return {
            error:
              "must call read_file on this path first (read-before-edit invariant).",
            path: abs,
          };
        }
        return applyEdits(
          abs,
          [{ old_string, new_string, replace_all }],
          "edit",
        );
      },
    }),

    multi_edit: tool({
      description:
        "Apply several exact-string replacements to a single file atomically. Each edit is applied in order to the running buffer; if any edit's old_string is missing or non-unique, the whole batch aborts before writing. Requires prior read_file on the path. Asks for user approval before writing.",
      inputSchema: z.object({
        path: z.string(),
        edits: z
          .array(
            z.object({
              old_string: z.string(),
              new_string: z.string(),
              replace_all: z.boolean().optional(),
            }),
          )
          .min(1),
      }),
      needsApproval: true,
      execute: async ({ path, edits }) => {
        const abs = resolvePath(path, ctx.getCwd());
        const safety = checkWritable(abs);
        if (!safety.ok) return { error: safety.reason, path: abs };
        if (!ctx.readCache.has(abs)) {
          return {
            error:
              "must call read_file on this path first (read-before-edit invariant).",
            path: abs,
          };
        }
        return applyEdits(abs, edits, "multi_edit");
      },
    }),
  } as const;
}
