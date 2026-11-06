import { workbench } from "@/modules/workbench";
import { locateTab, taskCloseIds } from "@/modules/workbench/model/workbench";
import {
  snapshot,
  useActiveTabId,
  useWorkbench,
} from "@/modules/workbench/store";
import { viewHandle } from "@/modules/workbench/viewHandles";
import { useEffect, useRef } from "react";
import { startBenchDriver } from "./driver";
import type { BenchAppApi } from "./types";

/**
 * Mounted by App only in TERAX_BENCH builds. It hands the live workbench actions to the scenario
 * driver (which runs once, after the first render) and renders nothing. A bench "tab" is a task.
 */
export default function BenchBridge() {
  const tabs = useWorkbench((s) => s.tabs);
  const booted = useWorkbench((s) => s.booted);
  const activeId = useActiveTabId() ?? -1;
  const api: BenchAppApi = {
    tabs,
    activeId,
    booted,
    setActiveId: workbench.activateTab,
    newTab: (cwd) => workbench.newTask({ cwd }).tabId,
    newBlockTab: (cwd) => workbench.newTask({ cwd, blocks: true }).tabId,
    newAgentGroupTab: (cwd, title, instances) => {
      const { leafIds } = workbench.newAgentTask(cwd, title, instances);
      return { tabId: leafIds[0], leafIds };
    },
    splitActivePane: (tabId, dir) => {
      workbench.activateTab(tabId);
      return workbench.splitTerminal(dir);
    },
    closeTab: (id) => {
      const task = locateTab(snapshot(), id)?.task;
      if (task) workbench.closeTabsNow(taskCloseIds(snapshot(), task.id));
    },
    readBuffer: (leafId, maxLines) =>
      viewHandle(leafId, "terminal")?.getBuffer(maxLines) ?? null,
  };
  const latest = useRef(api);
  latest.current = api;
  useEffect(() => {
    void startBenchDriver(() => latest.current);
  }, []);
  return null;
}
