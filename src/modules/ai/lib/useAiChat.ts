import { useChat, type UIMessage } from "@ai-sdk/react";
import { useMemo } from "react";
import { getOrCreateChat } from "./chatStore";

export function useAiChat(tabId: number, apiKey: string) {
  const chat = useMemo(() => getOrCreateChat(tabId, apiKey), [tabId, apiKey]);
  return useChat<UIMessage>({ chat });
}
