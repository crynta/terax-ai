import { useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { Tab, WorkflowTab } from "@/modules/tabs";
import { WorkflowCanvas } from "./components/WorkflowCanvas";
import type { WorkflowRecentFile } from "./lib/filePersistence";
import {
  type WorkflowDiscoveredProviderModels,
  workflowDiscoveredProviderModelsFromAiConfig,
} from "./lib/providerConfigUi";
import type { WorkflowDocument } from "./lib/schema";
import { registerDefaultWorkflowMediaAdapters } from "./lib/workflowMediaAdapters";

type Props = {
  tabs: Tab[];
  activeId: number;
  onDocumentChange?: (tabId: number, document: WorkflowDocument) => void;
  onSaveDocument?: (tabId: number, document: WorkflowDocument) => Promise<void>;
  onSaveAsDocument?: (
    tabId: number,
    document: WorkflowDocument,
    path: string,
  ) => Promise<void>;
  recentWorkflowFiles?: WorkflowRecentFile[];
  onOpenWorkflowPath?: (path: string) => void;
};

export function WorkflowStack({
  tabs,
  activeId,
  onDocumentChange,
  onSaveDocument,
  onSaveAsDocument,
  recentWorkflowFiles = [],
  onOpenWorkflowPath,
}: Props) {
  useEffect(
    () =>
      registerDefaultWorkflowMediaAdapters({
        getOpenAIApiKey: () => useChatStore.getState().apiKeys.openai,
      }),
    [],
  );

  const apiKeys = useChatStore((state) => state.apiKeys);
  const customEndpoints = usePreferencesStore((state) => state.customEndpoints);
  const discoveredProviderModels = useMemo<WorkflowDiscoveredProviderModels>(
    () =>
      workflowDiscoveredProviderModelsFromAiConfig({
        apiKeys,
        customEndpoints,
      }),
    [apiKeys, customEndpoints],
  );

  const workflows = tabs.filter(
    (tab): tab is WorkflowTab => tab.kind === "workflow",
  );
  if (workflows.length === 0) return null;

  return (
    <div className="relative h-full w-full">
      {workflows.map((tab) => {
        const visible = tab.id === activeId;
        return (
          <div
            key={tab.id}
            className={cn(
              "absolute inset-0 overflow-hidden rounded-md border border-border/60 bg-background",
              !visible && "invisible pointer-events-none",
            )}
            aria-hidden={!visible}
          >
            <div
              className="zoom-exempt h-full w-full"
              style={{
                height: "calc(100% * var(--app-zoom))",
                width: "calc(100% * var(--app-zoom))",
              }}
            >
              <WorkflowCanvas
                document={tab.document}
                visible={visible}
                filePath={tab.path}
                dirty={tab.dirty}
                discoveredProviderModels={discoveredProviderModels}
                onDocumentChange={(document) =>
                  onDocumentChange?.(tab.id, document)
                }
                onSaveDocument={
                  onSaveDocument
                    ? (document) => onSaveDocument(tab.id, document)
                    : undefined
                }
                onSaveAsDocument={
                  onSaveAsDocument
                    ? (document, path) =>
                        onSaveAsDocument(tab.id, document, path)
                    : undefined
                }
                recentWorkflowFiles={recentWorkflowFiles}
                onOpenWorkflowPath={onOpenWorkflowPath}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
