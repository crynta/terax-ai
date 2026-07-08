export { AgentStatusPill } from "./components/AgentStatusPill";
export { LocalAgentNotificationsBridge } from "./components/LocalAgentNotificationsBridge";
export {
  AgentRunBridge,
  AiInputBarConnect,
  AiMiniWindow,
  SelectionAskAi,
} from "./components/lazy";
export { useAiBootstrap } from "./hooks/useAiBootstrap";
export { useSelectionAskAi } from "./hooks/useSelectionAskAi";
export {
  type CustomEndpointKeys,
  clearKey,
  EMPTY_PROVIDER_KEYS,
  getAllCustomEndpointKeys,
  getAllKeys,
  getKey,
  hasAnyKey,
  type ProviderKeys,
  setKey,
} from "./lib/keyring";
export { useAiLiveBridge } from "./lib/useAiLiveBridge";
export {
  type AgentMeta,
  type AgentRunStatus,
  getActiveProviderKey,
  hasKeyForModel,
  stop,
  useChatStore,
} from "./store/chatStore";
// Heavy chat runtime (@ai-sdk/react + ai SDK) is intentionally NOT re-exported
// here: this barrel is eagerly imported by App, and a static re-export would
// pull the whole SDK into the startup graph. Import from ./store/chatRuntime.
