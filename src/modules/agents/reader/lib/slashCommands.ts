/**
 * Autocomplete for the Reader composer: `/` commands at the start of the
 * message and `@` file mentions anywhere. Pure: the composer feeds in its
 * text, caret and candidate lists and applies the returned edit.
 */

import { fuzzyScore } from "@/modules/command-palette/lib/fuzzy";

export type CommandSource = "builtin" | "user" | "project" | "plugin" | "skill";

export type SlashCommand = {
  /** What follows the `/`. */
  name: string;
  description: string;
  source: CommandSource;
};

/** Claude Code's own commands. A static table: add new ones here. */
export const BUILTIN_COMMANDS: readonly SlashCommand[] = (
  [
    ["add-dir", "Add another working directory"],
    ["agents", "Manage subagents"],
    ["bashes", "List and manage background shells"],
    ["bug", "Report a bug to Anthropic"],
    ["clear", "Clear the conversation and start fresh"],
    ["compact", "Summarise the conversation to free context"],
    ["config", "Open settings"],
    ["context", "Show what is using the context window"],
    ["cost", "Show token usage and cost for this session"],
    ["doctor", "Check the Claude Code installation"],
    ["exit", "Exit Claude Code"],
    ["export", "Export the conversation to a file or the clipboard"],
    ["help", "Show help and available commands"],
    ["hooks", "Manage hook configurations"],
    ["ide", "Connect to an IDE"],
    ["init", "Create a CLAUDE.md guide for this project"],
    ["login", "Sign in to your Anthropic account"],
    ["logout", "Sign out"],
    ["mcp", "Manage MCP server connections"],
    ["memory", "Edit CLAUDE.md memory files"],
    ["model", "Choose the model"],
    ["output-style", "Choose the output style"],
    ["permissions", "View and change tool permissions"],
    ["plan", "Enter plan mode"],
    ["plugin", "Manage plugins and marketplaces"],
    ["pr-comments", "Fetch comments from a pull request"],
    ["release-notes", "Show release notes"],
    ["resume", "Resume a previous conversation"],
    ["review", "Review a pull request"],
    ["rewind", "Rewind the conversation and code to an earlier point"],
    ["sandbox", "Configure sandboxed shell commands"],
    ["security-review", "Review pending changes for security issues"],
    ["status", "Show version, model, account and connectivity"],
    ["statusline", "Set up the status line"],
    ["terminal-setup", "Install the Shift+Enter key binding"],
    ["todos", "List the current to-dos"],
    ["upgrade", "Upgrade your plan"],
    ["usage", "Show plan usage limits"],
    ["vim", "Toggle vim editing mode"],
  ] as const
).map(([name, description]) => ({ name, description, source: "builtin" }));

export type Trigger =
  | { kind: "slash"; query: string; start: number; end: number }
  | { kind: "mention"; query: string; start: number; end: number };

const SLASH_AT_START = /^\/([\w:.-]*)$/;
const MENTION_BEFORE_CARET = /(^|\s)@([^\s@]*)$/;

/**
 * The autocomplete in effect at `caret`: a `/command` that is the whole text
 * so far, or an `@path` token touching the caret.
 */
export function findTrigger(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret);
  const slash = SLASH_AT_START.exec(before);
  if (slash) return { kind: "slash", query: slash[1], start: 0, end: caret };
  const mention = MENTION_BEFORE_CARET.exec(before);
  if (mention) {
    const start = caret - mention[2].length - 1;
    return { kind: "mention", query: mention[2], start, end: caret };
  }
  return null;
}

/**
 * Commands matching `query`, best first: name matches outrank description
 * matches, and built-ins win ties so `/compact` beats a plugin's.
 */
export function rankCommands(
  query: string,
  commands: readonly SlashCommand[],
  limit = 50,
): SlashCommand[] {
  if (!query) {
    return [...commands]
      .sort(
        (a, b) =>
          Number(b.source === "builtin") - Number(a.source === "builtin") ||
          a.name.localeCompare(b.name),
      )
      .slice(0, limit);
  }
  const scored: { command: SlashCommand; score: number }[] = [];
  for (const command of commands) {
    const name = fuzzyScore(query, command.name);
    const description = fuzzyScore(query, command.description);
    if (name === null && description === null) continue;
    const prefix = command.name.toLowerCase().startsWith(query.toLowerCase());
    const score =
      (name ?? -1000) * 2 +
      (description ?? 0) * 0.2 +
      (prefix ? 50 : 0) +
      (command.source === "builtin" ? 1 : 0);
    scored.push({ command, score });
  }
  scored.sort(
    (a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name),
  );
  return scored.slice(0, limit).map((s) => s.command);
}

/**
 * The text and caret after accepting `insert` for `trigger`: commands and
 * files get a trailing space, folders keep the caret right after the `/` so
 * the search can continue into them.
 */
export function applySuggestion(
  text: string,
  trigger: Trigger,
  insert: string,
  options: { folder?: boolean } = {},
): { text: string; caret: number } {
  const token =
    trigger.kind === "slash"
      ? `/${insert}`
      : `@${insert}${options.folder && !insert.endsWith("/") ? "/" : ""}`;
  const after = text.slice(trigger.end);
  const spacer = options.folder || after.startsWith(" ") ? "" : " ";
  const next = text.slice(0, trigger.start) + token + spacer + after;
  return { text: next, caret: trigger.start + token.length + spacer.length };
}
