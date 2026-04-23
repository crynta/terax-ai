import { useCallback, useState } from "react";

export type AgentStatus = "thinking" | "working" | "done" | "error";

export type AgentSession = {
  id: string;
  tabId: number;
  prompt: string;
  status: AgentStatus;
  createdAt: number;
};

export function useSessions() {
  const [byTab, setByTab] = useState<Record<number, AgentSession>>({});

  const start = useCallback((tabId: number, prompt: string) => {
    const session: AgentSession = {
      id: `${tabId}:${Date.now()}`,
      tabId,
      prompt,
      status: "thinking",
      createdAt: Date.now(),
    };
    setByTab((prev) => ({ ...prev, [tabId]: session }));
    return session;
  }, []);

  const clear = useCallback((tabId: number) => {
    setByTab((prev) => {
      if (!(tabId in prev)) return prev;
      const next = { ...prev };
      delete next[tabId];
      return next;
    });
  }, []);

  const get = useCallback(
    (tabId: number): AgentSession | null => byTab[tabId] ?? null,
    [byTab],
  );

  return { start, clear, get };
}
