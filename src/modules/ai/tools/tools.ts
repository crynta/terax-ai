import { buildAgentBrowserTools } from "./agentBrowser";
import { buildEditTools } from "./edit";
import { buildFsTools } from "./fs";
import { buildKatanaTools } from "./katana";
import { buildMitmproxyTools } from "./mitmproxy";
import { buildNucleiTools } from "./nuclei";
import { buildSearchTools } from "./search";
import { buildShellTools } from "./shell";
import { buildSubagentTools } from "./subagent";
import { buildTerminalTools } from "./terminal";
import { buildTodoTools } from "./todo";
import { buildHacktricksTools } from "./hacktricks";
import { buildProtocolTools } from "./protocols";
import { buildWordlistTools } from "./wordlists";
import { buildExploitationTools } from "./exploitation";
import { buildADTools } from "./activedirectory";
import { buildQolTools } from "./qol";
import { buildReportingTools } from "./reporting";

export { resolvePath, type ToolContext } from "./context";

/**
 * AI tool definitions.
 *
 * Approval policy:
 *  - Read-only tools (`read_file`, `list_directory`, `grep`, `glob`)
 *    auto-execute, but go through the security guard which refuses obvious
 *    secret paths (.env*, .ssh/, credentials, etc.).
 *  - Mutating tools (`write_file`, `edit`, `multi_edit`, `create_directory`,
 *    `run_command`) require explicit user approval — the AI SDK pauses on
 *    tool-call and surfaces a `tool-approval-request` part that the UI
 *    renders as a confirmation card.
 *  - `edit` / `multi_edit` additionally enforce a read-before-edit invariant
 *    (the model must have called read_file on the path earlier in the
 *    session).
 *
 * The model sees absolute paths only after they are resolved against the
 * active terminal's cwd (provided via `getCwd`); it should not invent paths
 * outside that.
 */
export function buildTools(ctx: import("./context").ToolContext) {
  return {
    ...buildFsTools(ctx),
    ...buildEditTools(ctx),
    ...buildSearchTools(ctx),
    ...buildShellTools(ctx),
    ...buildSubagentTools(ctx),
    ...buildTerminalTools(ctx),
    ...buildTodoTools(ctx),
    ...buildHacktricksTools(),
    ...buildProtocolTools(ctx),
    ...buildAgentBrowserTools(ctx),
    ...buildMitmproxyTools(ctx),
    ...buildKatanaTools(ctx),
    ...buildNucleiTools(ctx),
    ...buildWordlistTools(ctx),
    ...buildExploitationTools(ctx),
    ...buildADTools(ctx),
    ...buildQolTools(ctx),
    ...buildReportingTools(ctx),
  } as const;
}

export type ChatTools = ReturnType<typeof buildTools>;
