/**
 * Prompt context + project memory injection for the webview Pi agent.
 *
 * Mirrors the Vercel AI SDK transport (src/modules/ai/lib/transport.ts): an
 * `<env>` block carrying the live IDE context is prepended to the user turn,
 * and TERAX.md project memory (capped) is injected into the system prompt.
 * Without this the webview agent has no idea what file/workspace/terminal the
 * user is looking at — a parity gap with the Vercel AI transport.
 */
import type { PiPromptContext } from "./sessions";

const TERAX_MD_MAX_BYTES = 32 * 1024;

/** Build an `<env>` block from the live prompt context, or null if empty. */
export function formatPiEnvBlock(
  context: PiPromptContext | null | undefined,
): string | null {
  if (!context) return null;
  const lines: string[] = [];
  if (context.workspaceRoot) {
    lines.push(`workspace_root: ${context.workspaceRoot}`);
  }
  if (context.activeTerminalCwd) {
    lines.push(`active_terminal_cwd: ${context.activeTerminalCwd}`);
  }
  if (context.activeFile) {
    lines.push(`active_file: ${context.activeFile}`);
  }
  if (context.activeTerminalPrivate) {
    lines.push("active_terminal_mode: private");
  }
  if (lines.length === 0) return null;
  return `<env>\n${lines.join("\n")}\n</env>`;
}

/** Prepend the env block to a prompt, or return it unchanged if no context. */
export function buildPromptWithContext(
  promptText: string,
  context: PiPromptContext | null | undefined,
): string {
  const env = formatPiEnvBlock(context);
  return env ? `${env}\n\n${promptText}` : promptText;
}

/**
 * Read `<workspaceRoot>/TERAX.md` project memory, capped at the size limit.
 * The reader is injected so this stays pure and testable; callers pass a
 * Tauri-backed file reader. Never throws.
 */
export async function readProjectMemory(
  workspaceRoot: string | null | undefined,
  readText: (path: string) => Promise<string | null>,
): Promise<string | null> {
  if (!workspaceRoot) return null;
  const path = `${workspaceRoot.replace(/\/$/, "")}/TERAX.md`;
  try {
    const content = await readText(path);
    if (!content) return null;
    return content.length > TERAX_MD_MAX_BYTES
      ? content.slice(0, TERAX_MD_MAX_BYTES)
      : content;
  } catch {
    return null;
  }
}

/** Append a `<project-memory>` block to a system prompt, if memory exists. */
export function withProjectMemory(
  systemPrompt: string,
  memory: string | null,
): string {
  if (!memory) return systemPrompt;
  return `${systemPrompt}\n\n<project-memory>\n${memory}\n</project-memory>`;
}
