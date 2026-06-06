import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import {
  buildPiLocalAgentStatuses,
  piLocalAgentByName,
} from "@/modules/pi/lib/local-agents";
import { piNative } from "@/modules/pi/lib/native";
import { usePiControllerState } from "@/modules/pi/lib/PiControllerProvider";
import { useWorkspaceEnvStore } from "@/modules/workspace";

const INITIAL_LOCAL_AGENT_STATUSES = buildPiLocalAgentStatuses([]);

export function usePiLocalAgentsPanel() {
  const [localAgents, setLocalAgents] = usePiControllerState(
    "localAgents",
    INITIAL_LOCAL_AGENT_STATUSES,
  );
  const [isLocalAgentsRefreshing, setIsLocalAgentsRefreshing] = useState(false);
  const terminalAgentSessions = useAgentStore((state) => state.sessions);
  const localAgentState = useAgentStore((state) => state.localAgent);
  const workspaceEnv = useWorkspaceEnvStore((state) => state.env);

  const localAgentActivities = useMemo(() => {
    const activities = Object.values(terminalAgentSessions).map((agent) => {
      const def = piLocalAgentByName(agent.agent);
      return {
        id: def?.id,
        label: def?.label ?? agent.agent,
        status: agent.status,
        detail: `Terminal ${agent.tabId}`,
      };
    });

    if (localAgentState) {
      const def = piLocalAgentByName(localAgentState.agent);
      const key = def?.id ?? localAgentState.agent.trim().toLowerCase();
      const alreadyShown = activities.some(
        (activity) =>
          (activity.id ?? activity.label.trim().toLowerCase()) === key,
      );
      if (!alreadyShown) {
        activities.unshift({
          id: def?.id,
          label: def?.label ?? localAgentState.agent,
          status: localAgentState.status,
          detail: "Terax agent",
        });
      }
    }

    return activities;
  }, [localAgentState, terminalAgentSessions]);

  const refreshLocalAgents = useCallback(async () => {
    setIsLocalAgentsRefreshing(true);
    try {
      const result = await piNative.localAgentsStatus(workspaceEnv);
      setLocalAgents(buildPiLocalAgentStatuses(result.agents));
    } catch {
      setLocalAgents(INITIAL_LOCAL_AGENT_STATUSES);
    } finally {
      setIsLocalAgentsRefreshing(false);
    }
  }, [workspaceEnv]);

  useEffect(() => {
    void refreshLocalAgents();
  }, [refreshLocalAgents]);

  return {
    isLocalAgentsRefreshing,
    localAgentActivities,
    localAgents,
    refreshLocalAgents,
  };
}
