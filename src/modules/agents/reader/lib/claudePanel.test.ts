import { describe, expect, it } from "vitest";
import { panelKeyBytes, parseClaudePanel, samePanel } from "./claudePanel";

// Screens captured from Claude Code 2.1.306 (110×40).
const USAGE =
  "▎ Welcome to Meesho Managed Claude. Reach out to #claude-code on slack in case of any queries.\n  1 more notice hidden\n▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔\n   Settings  Status   Config   Usage   Stats\n\n   Session\n\n   Total cost:            $0.0000\n   Total duration (API):  0s\n   Total duration (wall): 9s\n   Total code changes:    0 lines added, 0 lines removed\n   Usage:                 0 input, 0 output, 0 cache read, 0 cache write\n\n\n   Plugin skill-listing footprint\n   What each plugin's skill descriptions add to the system prompt (cached input after the first turn). \n   Agents and MCP tools not yet counted.\n\n   vercel                      4 skills · ~225 tok/turn\n\n   Total                       ~225 tok/turn\n\n   Current session\n   █████████████████                                  34% used\n   Resets 4am (Asia/Calcutta)\n\n   Current week (all models)\n   ███████████████████████████▌                       55% used\n   Resets Nov 7 at 8:30am (Asia/Calcutta)\n\n   Current week (Fable)\n   ████████████████████████████▍                      57% used\n   Resets Nov 7 at 8:30am (Asia/Calcutta)\n   \n   What's contributing to your limits usage?\n   Approximate · sessions on this machine only\n\n   Last 24h · shares overlap\n\n   95%  Start fresh when you switch tasks · run /clear                                                      ↓\n";
const MCP =
  "\n ▐▛███▛█   Claude Code v2.1.306\n▝▜██████▀  Fable 5.1 with high effort · Claude Team\n ▝▝   ▝▝   ~/Documents/Meesho/Notes\n\n▎ Message from Meesho L1 Demand + Supply 2:\n▎ Welcome to Meesho Managed Claude. Reach out to #claude-code on slack in case of any queries.\n  1 more notice hidden\n\n\n\n▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ ● high · /effort ▔\n   Manage MCP servers\n   21 servers\n\n     Local MCPs (/Users/dharmaraghavasai/.claude.json [project: /Users/dharmaraghavasai/Documents/Meesho/N…\n   ❯ ✔ meeupp                      48 tools\n\n     User MCPs (/Users/dharmaraghavasai/.claude.json)\n     ✔ bifrost                     17 tools\n     ⚠ mdocs                       needs authentication\n\n     claude.ai\n     ✔ claude.ai Atlassian Rovo    41 tools\n     ✔ claude.ai Claude Docs       8 tools\n     ⚠ claude.ai Gmail             needs authentication\n     ⚠ claude.ai Google Calendar   needs authentication\n     ✔ claude.ai Google Docs       2 tools\n     ✔ claude.ai Google Drive      11 tools\n     ⚠ claude.ai Google Sheets     needs authentication\n     ✔ claude.ai Slack             19 tools\n     ✔ claude.ai Superset MCP      26 tools\n     → Show unused connectors      7 hidden\n\n     Built-in MCPs (always available)           \n     ✔ plugin:ucl:ucl              140 tools\n     ⚠ plugin:vercel:vercel        needs authentication\n\n   https://code.claude.com/docs/en/mcp for help\n   ↑/↓ to navigate · Enter to confirm · Esc to cancel\n";
const MCP_MOVED =
  "\n ▐▛███▛█   Claude Code v2.1.306\n▝▜██████▀  Fable 5.1 with high effort · Claude Team\n ▝▝   ▝▝   ~/Documents/Meesho/Notes\n\n▎ Message from Meesho L1 Demand + Supply 2:\n▎ Welcome to Meesho Managed Claude. Reach out to #claude-code on slack in case of any queries.\n  1 more notice hidden\n\n\n\n▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ ● high · /effort ▔\n   Manage MCP servers\n   21 servers\n\n     Local MCPs (/Users/dharmaraghavasai/.claude.json [project: /Users/dharmaraghavasai/Documents/Meesho/N…\n     ✔ meeupp                      48 tools\n\n     User MCPs (/Users/dharmaraghavasai/.claude.json)\n   ❯ ✔ bifrost                     17 tools\n     ⚠ mdocs                       needs authentication\n\n     claude.ai\n     ✔ claude.ai Atlassian Rovo    41 tools\n     ✔ claude.ai Claude Docs       8 tools\n     ⚠ claude.ai Gmail             needs authentication\n     ⚠ claude.ai Google Calendar   needs authentication\n     ✔ claude.ai Google Docs       2 tools\n     ✔ claude.ai Google Drive      11 tools\n     ⚠ claude.ai Google Sheets     needs authentication\n     ✔ claude.ai Slack             19 tools\n     ✔ claude.ai Superset MCP      26 tools\n     → Show unused connectors      7 hidden\n\n     Built-in MCPs (always available)           \n     ✔ plugin:ucl:ucl              140 tools\n     ⚠ plugin:vercel:vercel        needs authentication\n\n   https://code.claude.com/docs/en/mcp for help\n   ↑/↓ to navigate · Enter to confirm · Esc to cancel\n";
const CONFIG =
  "▎ Welcome to Meesho Managed Claude. Reach out to #claude-code on slack in case of any queries.\n  1 more notice hidden\n▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ ● high · /effort ▔\n   Settings  Status   Config   Usage   Stats\n\n   ╭──────────────────────────────────────────────────────────────────────────────────────────────────────╮\n   │ ⌕ Search settings…                                                                                   │\n   ╰──────────────────────────────────────────────────────────────────────────────────────────────────────╯\n\n   ❯ Auto-compact                                true\n     Idle compaction                             true\n     Continue automatically at usage limit       true\n     Switch models when a message is flagged     Switch automatically ›\n     Show tips                                   true\n     Claude-drafted feedback                     notify\n     Reduce motion                               false\n     Thinking mode                               true\n     Thinking can't be turned off for Fable 5.1\n     Prompt suggestions                          true\n     Session recap                               true\n     Rewind code (checkpoints)                   true\n     Dynamic workflows                           true\n     Ultracode keyword trigger                   true\n     Dynamic workflow size                       medium (default)\n     Artifacts                                   true\n     Verbose output                              false\n     Terminal progress bar                       true\n     Show turn duration                          true\n     Time format                                 auto ›\n     Default permission mode                     Manual\n     Worktree base ref                           fresh\n     Use auto mode during plan                   true\n     Respect .gitignore in file picker           true\n     Skip the /copy picker                       false\n     Copy on select                              true\n     Auto-scroll                                 true\n     Open agents view by default                 false\n     ↓ 19 more\n\n   Type to filter · Enter/↓ to select · ↑ to tabs · Esc to clear\n";
const PROMPT =
  "\n ▐▛███▛█   Claude Code v2.1.306\n▝▜██████▀  Fable 5.1 with high effort · Claude Team\n ▝▝   ▝▝   ~/Documents/Meesho/Notes\n\n▎ Message from Meesho L1 Demand + Supply 2:\n▎ Welcome to Meesho Managed Claude. Reach out to #claude-code on slack in case of any queries.\n  1 more notice hidden\n\n\n\n\n\n\n\n\n    \n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n                                   ● high · /effort · Update available! Run: brew upgrade claude-code@latest\n──────────────────────────────────────────────────────────────────────────────────────────────────────────────\n❯ \n──────────────────────────────────────────────────────────────────────────────────────────────────────────────\n  Meesho 💡 Fable 5.1 | 📁 Notes | 💰 $0.00\n  ⏵⏵ auto mode on (shift+tab to cycle)\n";

describe("parseClaudePanel", () => {
  it("reads the /usage view: its tab bar and the usage meters", () => {
    const p = parseClaudePanel(USAGE);
    expect(p?.tabs).toEqual(["Settings", "Status", "Config", "Usage", "Stats"]);
    expect(p?.title).toBeNull();
    expect(p?.lines.join("\n")).toContain("34% used");
    expect(p?.lines[0]).toBe("Session");
    // Its last row is content cut off by the screen edge, not a key hint.
    expect(p?.hint).toBeNull();
  });

  it("reads /mcp: title, hint and the cursor row", () => {
    const p = parseClaudePanel(MCP);
    expect(p?.title).toBe("Manage MCP servers");
    expect(p?.hint).toBe("↑/↓ to navigate · Enter to confirm · Esc to cancel");
    expect(p?.lines[p.selected ?? -1]).toMatch(/^❯ ✔ meeupp/u);
    const moved = parseClaudePanel(MCP_MOVED);
    expect(moved?.lines[moved.selected ?? -1]).toMatch(/^❯ ✔ bifrost/u);
    expect(samePanel(p, moved)).toBe(false);
    expect(samePanel(p, parseClaudePanel(MCP))).toBe(true);
  });

  it("reads /config with its filter box and hint", () => {
    const p = parseClaudePanel(CONFIG);
    expect(p?.tabs?.[2]).toBe("Config");
    expect(p?.hint).toMatch(/^Type to filter/u);
    expect(p?.lines[p.selected ?? -1]).toMatch(/^❯ Auto-compact\s+true$/u);
  });

  it("is null once the prompt box is back", () => {
    expect(parseClaudePanel(PROMPT)).toBeNull();
    expect(parseClaudePanel("")).toBeNull();
  });
});

describe("panelKeyBytes", () => {
  it("sends terminal bytes for navigation and typing", () => {
    expect(panelKeyBytes({ key: "ArrowDown" })).toBe("\x1b[B");
    expect(panelKeyBytes({ key: "ArrowLeft" })).toBe("\x1b[D");
    expect(panelKeyBytes({ key: "Enter" })).toBe("\r");
    expect(panelKeyBytes({ key: "Escape" })).toBe("\x1b");
    expect(panelKeyBytes({ key: "Tab", shiftKey: true })).toBe("\x1b[Z");
    expect(panelKeyBytes({ key: "a" })).toBe("a");
    expect(panelKeyBytes({ key: "c", ctrlKey: true })).toBe("\x03");
  });

  it("leaves Cmd shortcuts and bare modifiers to the app", () => {
    expect(panelKeyBytes({ key: "c", metaKey: true })).toBeNull();
    expect(panelKeyBytes({ key: "Shift" })).toBeNull();
  });
});
