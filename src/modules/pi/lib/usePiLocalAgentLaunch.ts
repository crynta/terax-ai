import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback } from "react";
import { IS_WINDOWS } from "@/lib/platform";
import {
  buildPiLocalAgentLaunchCommand,
  type PiLocalAgentLaunchRequest,
  type PiLocalAgentStatus,
} from "@/modules/pi/lib/local-agents";
import type { WorkspaceEnv } from "@/modules/workspace";

export function usePiLocalAgentLaunch({
  onOpenLocalAgent,
  prompt,
  workspaceEnv,
}: {
  onOpenLocalAgent?: (request: PiLocalAgentLaunchRequest) => void;
  prompt: string;
  workspaceEnv: WorkspaceEnv;
}) {
  const openLocalAgentDocs = useCallback((agent: PiLocalAgentStatus) => {
    void openUrl(agent.docsUrl);
  }, []);

  const launchLocalAgent = useCallback(
    (agent: PiLocalAgentStatus, promptText: string | null = null) => {
      const command = buildPiLocalAgentLaunchCommand(agent, promptText, {
        windowsShell: IS_WINDOWS && workspaceEnv.kind === "local",
      });
      if (!command) {
        void openUrl(agent.docsUrl);
        return;
      }
      onOpenLocalAgent?.({
        id: agent.id,
        label: agent.label,
        command,
        prompt: promptText?.trim() ? promptText.trim() : null,
      });
    },
    [onOpenLocalAgent, workspaceEnv.kind],
  );

  const launchLocalAgentWithPrompt = useCallback(
    (agent: PiLocalAgentStatus) => launchLocalAgent(agent, prompt),
    [launchLocalAgent, prompt],
  );

  return { launchLocalAgent, launchLocalAgentWithPrompt, openLocalAgentDocs };
}
