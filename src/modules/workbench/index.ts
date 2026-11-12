export * as workbench from "./actions";
export { closeTabsNow, closeTabsReplacingLast } from "./actions";
export { type WorkbenchChrome, WorkbenchChromeContext } from "./chrome";
export { TaskStrip } from "./components/TaskStrip";
export { WorkbenchSurface } from "./components/WorkbenchSurface";
export { navigateEditor } from "./editorNavigation";
export {
  planClose,
  projectTasks,
  taskCloseIds,
} from "./model/workbench";
export { snapshot, useActiveTabId, useWorkbench } from "./store";
export { useProjectSync } from "./useProjectSync";
export { DEFAULT_PROJECT_ID, useWorkbenchBoot } from "./useWorkbenchBoot";
export { useWorkbenchPersistence } from "./useWorkbenchPersistence";
export { useViewHandle, viewHandle } from "./viewHandles";
