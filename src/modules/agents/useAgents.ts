import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

export type AgentInfo = {
  slug: string;
  displayName: string;
  description: string;
  accentColorHex: string;
  hasMemory: boolean;
};

export type AgentDefinition = {
  schemaVersion: number;
  slug: string;
  displayName: string;
  description: string;
  accentColorHex: string;
  systemPrompt: string;
  toolWhitelist: string[];
  skills: string[];
  memory: string;
  createdAt: string;
  updatedAt: string;
};

export function useAgents() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await invoke<AgentInfo[]>("agent_list");
      setAgents(list);
    } catch {
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const load = useCallback(async (slug: string) => {
    return invoke<AgentDefinition>("agent_load", { slug });
  }, []);

  const save = useCallback(
    async (agent: AgentDefinition) => {
      await invoke("agent_save", { agent });
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (slug: string) => {
      await invoke("agent_delete", { slug });
      await refresh();
    },
    [refresh],
  );

  const readMemory = useCallback(async (slug: string) => {
    return invoke<string>("agent_memory_read", { slug });
  }, []);

  const appendMemory = useCallback(async (slug: string, entry: string) => {
    await invoke("agent_memory_append", { slug, entry });
  }, []);

  return {
    agents,
    loading,
    load,
    save,
    remove,
    readMemory,
    appendMemory,
    refresh,
  };
}
