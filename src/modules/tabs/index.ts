export { TabBar, TabIcon } from "./TabBar";
export { TabSwitcherHud } from "./TabSwitcherHud";
export { useTabSwitcher } from "./lib/useTabSwitcher";
export { labelFor } from "./lib/tabLabel";
export {
  MAX_PANES_PER_TAB,
  useTabs,
  nextActiveInSpace,
  planCloseTabsToRight,
  planCloseOtherTabs,
  type CloseTabsPlan,
  type Tab,
  type EditorTab,
  type PreviewTab,
  type MarkdownTab,
  type AiDiffTab,
  type GitDiffTab,
  type GitHistoryTab,
  type GitCommitFileDiffTab,
  type AiDiffStatus,
} from "./lib/useTabs";
export { useWorkspaceCwd } from "./lib/useWorkspaceCwd";
export { useWindowTitle } from "./lib/useWindowTitle";
