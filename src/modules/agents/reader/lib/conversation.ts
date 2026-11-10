import {
  type AgentCommandLaunched,
  claudeResumeCommand,
  launchAgentCommand,
} from "@/modules/agents/lib/agentLaunchBridge";
import { basename } from "@/modules/agents/lib/sessionRows";
import { usePreferencesStore } from "@/modules/settings/preferences";

/**
 * Opens a new Claude tab in `cwd` resuming session `sessionId` (a fork with
 * `--fork-session` keeps the original untouched). Null when the launch
 * command can't be built or App hasn't registered a launcher.
 */
export function resumeChat(
  cwd: string | null,
  sessionId: string,
  fork = false,
): AgentCommandLaunched | null {
  const base = usePreferencesStore.getState().agentLaunchCommands.claude;
  const command = claudeResumeCommand(base, sessionId, fork);
  if (!command) return null;
  const folder = cwd ? basename(cwd) : "Claude";
  return launchAgentCommand({
    cwd,
    title: fork ? `Fork · ${folder}` : `Resume · ${folder}`,
    command,
  });
}
