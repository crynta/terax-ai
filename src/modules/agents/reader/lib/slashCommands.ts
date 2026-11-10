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

/**
 * Claude Code's own commands and bundled skills, as its `/` menu lists them
 * (v2.1.306). Skills and commands on disk (user, project, plugin, synced)
 * come from the backend instead. A static table: refresh it when Claude adds
 * commands.
 */
export const BUILTIN_COMMANDS: readonly SlashCommand[] = (
  [
    ["add-dir", "Add a new working directory"],
    ["advisor", "Let Claude consult a stronger model at key moments"],
    [
      "artifact-capabilities",
      "Runtime capabilities for published Artifact pages",
    ],
    ["artifact-diagramming", "Diagramming know-how for Artifacts"],
    ["artifacts", "Browse your published and shared artifacts"],
    ["auto-mode-setup", "Teach auto mode about your environment"],
    ["autocompact", "Set how full the context gets before auto-summarizing"],
    ["autofix-pr", "Monitor and autofix any issues with the current PR"],
    ["background", "Send this session to the background and free the terminal"],
    [
      "batch",
      "Research and plan a large-scale change, then execute it in parallel",
    ],
    ["branch", "Create a branch of the current conversation at this point"],
    ["btw", "Ask a quick side question without interrupting the main task"],
    ["bug", "Report a bug or share your conversation"],
    ["cd", "Move this session to a new working directory"],
    ["chrome", "Open Claude in Chrome settings"],
    ["claude-api", "Reference for the Claude API and Anthropic SDK"],
    ["clear", "Start a new session with empty context"],
    ["code-review", "Review the current diff, or a PR, branch or path"],
    ["color", "Set the prompt bar color for this session"],
    ["compact", "Free up context by summarizing the conversation so far"],
    ["config", "Open settings"],
    ["context", "Visualize current context usage as a colored grid"],
    [
      "copy",
      "Copy Claude's last response to the clipboard (/copy N for older ones)",
    ],
    ["dataviz", "Design guidance for charts, graphs and dashboards"],
    ["debug", "Enable debug logging for this session and help diagnose issues"],
    ["deep-research", "Deep research harness with parallel web searches"],
    ["design", "Make a new Design artifact from a brief"],
    ["design-login", "Authorize design-system access for /design-sync"],
    ["design-sync", "Push a React design system to claude.ai/design"],
    ["desktop", "Continue the current session in Claude Desktop"],
    ["diff", "Toggle the diff panel showing uncommitted changes"],
    ["doctor", "Health-check the Claude Code setup and fix issues"],
    ["effort", "Set effort level for model usage"],
    ["exit", "Exit the CLI"],
    ["export", "Export the current conversation to a file or clipboard"],
    ["fast", "Toggle fast mode (Opus 5.5)"],
    ["feedback", "Send feedback to Anthropic or report a bug"],
    [
      "fewer-permission-prompts",
      "Allowlist common read-only commands to cut permission prompts",
    ],
    ["focus", "Toggle focus view: just your prompt, summary, and response"],
    ["fork", "Copy this conversation into a new background session"],
    ["goal", "Set a goal Claude checks before stopping"],
    ["help", "Show help and available commands"],
    ["hooks", "View hook configurations for tool events"],
    ["ide", "Manage IDE integrations and show status"],
    ["import", "Import config from another AI coding agent"],
    ["init", "Initialize a CLAUDE.md file with codebase documentation"],
    ["insights", "Generate a report analyzing your Claude Code sessions"],
    ["install-github-app", "Set up Claude GitHub Actions for a repository"],
    ["install-slack-app", "Install the Claude Slack app"],
    ["keybindings", "Open your keyboard shortcuts file"],
    ["list-agents", "List subagents, teammates and other Claude sessions"],
    ["login", "Sign in with your Anthropic account"],
    ["logout", "Sign out from your Anthropic account"],
    ["loop", "Run a prompt or slash command on a recurring interval"],
    ["mcp", "Manage MCP servers"],
    ["memory", "Edit CLAUDE.md files and memory settings"],
    ["mobile", "Show QR code to download the Claude mobile app"],
    ["model", "Set the AI model for Claude Code"],
    ["output-style", "List output styles or switch to one"],
    ["permissions", "Manage allow and deny tool permission rules"],
    ["plan", "Enable plan mode or view the current session plan"],
    ["plugin", "Manage Claude Code plugins"],
    [
      "plugin-authoring",
      "Make a mod: change Claude's own interface or behaviour",
    ],
    [
      "powerup",
      "Discover Claude Code features through quick interactive lessons",
    ],
    ["radio", "Listen to Claude FM lo-fi radio"],
    ["rate-limit-options", "Manage usage limits and upgrade options"],
    ["recap", "Generate a one-line session recap now"],
    ["release-notes", "View release notes"],
    [
      "reload-plugins",
      "Activate pending plugin changes in the current session",
    ],
    [
      "reload-skills",
      "Pick up skills added or changed on disk during this session",
    ],
    [
      "remote-control",
      "Control this session from your phone or claude.ai/code",
    ],
    ["remote-env", "Choose the default environment for cloud agents"],
    ["rename", "Rename the current conversation"],
    ["resume", "Resume a previous conversation"],
    ["rewind", "Restore the code and/or conversation to a previous point"],
    ["run", "Launch and drive this project's app to see a change working"],
    ["run-skill-generator", "Author or improve this project's run skill"],
    ["sandbox", "Configure sandboxed shell commands"],
    ["schedule", "Create, update, list, or run scheduled cloud agents"],
    ["scroll-speed", "Adjust mouse wheel scroll speed"],
    ["security-review", "Complete a security review of the pending changes"],
    [
      "simplify",
      "Review changed code for reuse, simplification and efficiency",
    ],
    ["skill-doctor", "Show which loaded skills are unused and costing context"],
    ["skills", "List available skills"],
    ["slides", "Make a new Slides deck artifact from a brief"],
    ["status", "Show version, model, account and connectivity"],
    ["statusline", "Set up Claude Code's status line UI"],
    ["stickers", "Order Claude Code stickers"],
    ["subtask", "Send a subagent off with your full context"],
    ["tasks", "View and manage everything running in the background"],
    ["team-onboarding", "Help teammates ramp on Claude Code with a guide"],
    [
      "teleport",
      "Send this session to the cloud, or resume one from claude.ai",
    ],
    ["terminal-setup", "Install Shift+Enter key binding for newlines"],
    ["theme", "Change the theme"],
    ["tui", "Set the terminal UI renderer (default | fullscreen)"],
    ["update-config", "Configure the Claude Code harness via settings.json"],
    ["upgrade", "Upgrade to Max for higher rate limits"],
    ["usage", "Show session cost, plan usage, and activity stats"],
    [
      "usage-credits",
      "Configure usage credits or request them from your admin",
    ],
    ["verify", "Verify that a code change actually does what it should"],
    ["voice", "Toggle voice mode"],
    ["workflow-authoring", "Reference for writing Workflow scripts"],
    ["workflows", "Browse running and completed workflows"],
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
