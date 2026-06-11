/**
 * Turn-diff computation — extracts structured change summaries from Pi session events.
 *
 * A "turn" spans from one `session.input` to the next (or to session end).
 * The diff captures: files read/edited/written, commands run, token usage.
 *
 * Design: pure functions over the event array. No side effects. No persistence.
 * The caller (webview-session) emits the result as a `session.turn_diff` event.
 */

import type { PiSessionEvent, PiUsageRecord } from "./types";
import { PI_SESSION_EVENT } from "./types";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PiFileChange = {
  path: string;
  /** What happened to this file within the turn */
  action: "read" | "edited" | "written" | "created" | "deleted";
};

export type PiCommandRun = {
  command: string;
  exitCode: number | null;
  /** Milliseconds if available */
  durationMs: number | null;
};

export type PiTurnDiff = {
  /** Ordered list of file operations (deduplicated, last action wins) */
  files: PiFileChange[];
  /** Shell commands executed */
  commands: PiCommandRun[];
  /** Token usage for this turn (null if usage event not yet received) */
  usage: PiUsageRecord | null;
  /** MCP tool calls (non-file, non-shell) */
  toolCalls: { toolName: string; success: boolean }[];
};

export const EMPTY_TURN_DIFF: PiTurnDiff = {
  files: [],
  commands: [],
  usage: null,
  toolCalls: [],
};

// ─── Helpers ────────────────────────────────────────────────────────────────

type ToolMeta = {
  name: string;
  callId: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
};

const FILE_TOOL_NAMES = new Set([
  "read",
  "write_file",
  "edit_file",
  "write",
  "edit",
]);

const SHELL_TOOL_NAMES = new Set(["bash_run", "bash", "shell"]);

/**
 * Extract file path from a tool input object.
 * Handles `{path}`, `{file_path}`, `{filePath}`, `{file}`.
 */
function extractFilePath(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const raw = obj.path ?? obj.file_path ?? obj.filePath ?? obj.file ?? null;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * Extract command string from a shell tool input.
 * Handles `{command}`, `{cmd}`.
 */
function extractCommand(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  const raw = obj.command ?? obj.cmd ?? null;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * Determine file action from tool name and whether there was an output/error.
 */
function fileActionForTool(
  toolName: string,
  _hadOutput: boolean,
  isError: boolean,
): PiFileChange["action"] {
  // Failed operations still show their intended action
  // but won't be recorded as having changed the file
  if (isError) {
    return "read"; // Attempted but failed — treat as read for diff purposes
  }
  switch (toolName) {
    case "read":
      return "read";
    case "edit_file":
    case "edit":
      return "edited";
    case "write_file":
    case "write":
      return "written";
    default:
      return "read";
  }
}

/**
 * Merge a new file change into the deduplicated map (last action wins).
 */
function mergeFileChange(
  map: Map<string, PiFileChange>,
  change: PiFileChange,
): void {
  const existing = map.get(change.path);
  if (!existing) {
    map.set(change.path, change);
    return;
  }
  // Upgrade: read → edited → written (keep highest action)
  const priority: Record<PiFileChange["action"], number> = {
    read: 0,
    edited: 1,
    written: 2,
    created: 3,
    deleted: 4,
  };
  if (priority[change.action] > priority[existing.action]) {
    existing.action = change.action;
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

/**
 * Compute a turn diff from a slice of events.
 *
 * @param events — all session events (will be filtered to the turn range)
 * @param fromEventId — the `session.input` event ID that starts this turn.
 *                      If null, processes from the beginning.
 * @param untilEventId — exclusive upper bound event ID (typically the next
 *                        `session.input` or the turn_diff event itself).
 *                        If null, processes to the end.
 */
export function computeTurnDiff(
  events: PiSessionEvent[],
  fromEventId: string | null,
  untilEventId: string | null,
): PiTurnDiff {
  const fileMap = new Map<string, PiFileChange>();
  const commands: PiCommandRun[] = [];
  const toolCalls: PiTurnDiff["toolCalls"] = [];
  let usage: PiUsageRecord | null = null;

  // Collect tool start/result pairs
  const toolStarts = new Map<string, ToolMeta>();

  let inRange = fromEventId === null;

  for (const event of events) {
    // Skip events from other sessions
    if (fromEventId === null && untilEventId === null) {
      // Process all events
    } else if (!inRange) {
      if (event.id === fromEventId) {
        inRange = true;
        // Don't process the input event itself
        continue;
      }
      continue;
    }

    // Check upper bound (exclusive)
    if (untilEventId !== null && event.id === untilEventId) {
      break;
    }

    // Process events in range
    if (event.type === PI_SESSION_EVENT.Usage) {
      const p = event.payload;
      usage = {
        inputTokens: (p.inputTokens as number) ?? 0,
        outputTokens: (p.outputTokens as number) ?? 0,
        cachedInputTokens: (p.cachedInputTokens as number | null) ?? null,
        costUsd: (p.costUsd as number | null) ?? null,
        modelId: (p.modelId as string | null) ?? null,
        providerId: (p.providerId as string | null) ?? null,
        latencyMs: (p.latencyMs as number | null) ?? null,
      };
      continue;
    }

    if (event.type === PI_SESSION_EVENT.ToolStart) {
      const p = event.payload;
      const name = (p.toolName as string) ?? "";
      const callId = (p.toolCallId as string) ?? event.id;
      toolStarts.set(callId, {
        name,
        callId,
        input: p.input,
      });
      continue;
    }

    if (event.type === PI_SESSION_EVENT.ToolResult) {
      const p = event.payload;
      const callId = (p.toolCallId as string) ?? event.id;
      const name = (p.toolName as string) ?? "";
      const isError = (p.isError as boolean) ?? false;
      const input = toolStarts.get(callId)?.input ?? p.input;

      if (FILE_TOOL_NAMES.has(name)) {
        const filePath = extractFilePath(input);
        if (filePath) {
          mergeFileChange(fileMap, {
            path: filePath,
            action: fileActionForTool(name, true, isError),
          });
        }
      } else if (SHELL_TOOL_NAMES.has(name)) {
        const cmd = extractCommand(input);
        if (cmd) {
          commands.push({
            command: cmd,
            exitCode: isError ? 1 : 0,
            durationMs: null,
          });
        }
      } else {
        // MCP or other tool
        toolCalls.push({
          toolName: name,
          success: !isError,
        });
      }

      toolStarts.delete(callId);
    }
  }

  // Also collect unmatched tool starts (started but never completed)
  for (const [, meta] of toolStarts) {
    if (FILE_TOOL_NAMES.has(meta.name)) {
      const filePath = extractFilePath(meta.input);
      if (filePath) {
        mergeFileChange(fileMap, {
          path: filePath,
          action: fileActionForTool(meta.name, false, false),
        });
      }
    } else if (SHELL_TOOL_NAMES.has(meta.name)) {
      const cmd = extractCommand(meta.input);
      if (cmd) {
        commands.push({
          command: cmd,
          exitCode: null,
          durationMs: null,
        });
      }
    } else {
      toolCalls.push({
        toolName: meta.name,
        success: false, // Never completed
      });
    }
  }

  return {
    files: Array.from(fileMap.values()),
    commands,
    usage,
    toolCalls,
  };
}

/**
 * Quick summary string for a turn diff (used in collapsed UI).
 */
export function turnDiffSummaryLabel(diff: PiTurnDiff): string | null {
  const parts: string[] = [];
  if (diff.files.length > 0) {
    parts.push(
      `${diff.files.length} file${diff.files.length !== 1 ? "s" : ""}`,
    );
  }
  if (diff.commands.length > 0) {
    parts.push(
      `${diff.commands.length} cmd${diff.commands.length !== 1 ? "s" : ""}`,
    );
  }
  if (diff.toolCalls.length > 0) {
    parts.push(
      `${diff.toolCalls.length} tool${diff.toolCalls.length !== 1 ? "s" : ""}`,
    );
  }
  if (diff.usage) {
    const total = diff.usage.inputTokens + diff.usage.outputTokens;
    if (total > 0) {
      parts.push(
        total >= 1000
          ? `${Math.round(total / 1000)}K tokens`
          : `${total} tokens`,
      );
    }
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
