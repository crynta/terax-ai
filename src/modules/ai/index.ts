export {
  AgentRunBridge,
  AiInputBar,
  AiInputBarConnect,
  AiMiniWindow,
  SelectionAskAi,
} from "./components/lazy";
export { AgentStatusPill } from "./components/AgentStatusPill";
export { useAiBootstrap } from "./hooks/useAiBootstrap";
export { useSelectionAskAi } from "./hooks/useSelectionAskAi";
export { useAiLiveBridge } from "./lib/useAiLiveBridge";
export { LocalAgentNotificationsBridge } from "./components/LocalAgentNotificationsBridge";
export {
  EMPTY_PROVIDER_KEYS,
  getAllKeys,
  getAllCustomEndpointKeys,
  getKey,
  setKey,
  clearKey,
  hasAnyKey,
  type ProviderKeys,
  type CustomEndpointKeys,
} from "./lib/keyring";
export {
  getActiveProviderKey,
  hasKeyForModel,
  stop,
  useChatStore,
  type AgentMeta,
  type AgentRunStatus,
} from "./store/chatStore";
// Heavy chat runtime (@ai-sdk/react + ai SDK) is intentionally NOT re-exported
// here: this barrel is eagerly imported by App, and a static re-export would
// pull the whole SDK into the startup graph. Import from ./store/chatRuntime.
