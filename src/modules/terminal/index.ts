export { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";
export { TerminalStack } from "./TerminalStack";
export {
  clearFocusedTerminal,
  disposeSession,
  leafHasForegroundProcess,
  leafIdForPty,
  navigateFocusedBlocks,
  ptyIdForLeaf,
  respawnSession,
  whenSessionReady,
  writeToSession,
} from "./lib/useTerminalSession";
export {
  aggregateAgentPhases,
  type AgentTabStatus,
  useAgentActivityStore,
} from "./lib/agentActivity";
export { useTerminalFileDrop } from "./lib/useTerminalFileDrop";
export {
  findLeafCwd,
  hasLeaf,
  isLeaf,
  leafIds,
  type PaneBounds,
  type PaneId,
  type PaneNode,
  type SplitDir,
} from "./lib/panes";
