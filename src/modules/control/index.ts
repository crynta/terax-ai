export {
  type AgentDecision,
  connectAgentEvents,
  resolveAgentDecision,
} from "./lib/agentDecisions";
export {
  parseAgentHookEvent,
  parseTerminalNotification,
  signalToModelEvent,
  subscribeAgentEvents,
  subscribeTerminalNotifications,
  type TerminalNotification,
  type TerminalNotificationKind,
} from "./lib/agentEvents";
export {
  agentHooksInstalled,
  applyAgentHooksPlan,
  disableAgentHooks,
  enableAgentHooks,
  type HooksAction,
  type HooksPlan,
  planAgentHooks,
} from "./lib/hooksConfig";
export { useControlBridge } from "./useControlBridge";
