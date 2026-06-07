import { Panel } from "@xyflow/react";
import {
  type ChangeEvent,
  createContext,
  type ReactNode,
  type RefObject,
  use,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { WorkflowRecentFile } from "../lib/filePersistence";
import type {
  WorkflowArtifact,
  WorkflowDocument,
  WorkflowNodeType,
} from "../lib/schema";
import {
  ArtifactList,
  ArtifactPreviewModal,
  pathBasename,
} from "./WorkflowCanvasParts";

const nodePalette: Array<{ type: WorkflowNodeType; label: string }> = [
  { type: "textPrompt", label: "Text" },
  { type: "imageGeneration", label: "Image" },
  { type: "videoGeneration", label: "Video" },
  { type: "audioGeneration", label: "Audio" },
  { type: "terminal", label: "Terminal" },
  { type: "shellCommand", label: "Command" },
  { type: "agent", label: "Agent" },
  { type: "httpRequest", label: "HTTP" },
  { type: "fileOperation", label: "File" },
  { type: "browserAutomation", label: "Browser" },
  { type: "output", label: "Output" },
];

export type WorkflowCanvasPanelsState = {
  dirty: boolean;
  document: WorkflowDocument;
  previewArtifact: WorkflowArtifact | null;
  readyNodeCount: number;
  safeReadyNodeCount: number;
  saveAsUnavailable: boolean;
  savingFile: boolean;
  selectedNodeId: string | null;
  selectedNodeRunAvailable: boolean;
  workflowIoMessage: string | null;
  workflowRunning: boolean;
};

export type WorkflowCanvasPanelsActions = {
  addNode: (type: WorkflowNodeType) => void;
  artifactActionError: (error: unknown) => void;
  artifactMaterialized: (artifact: WorkflowArtifact) => void;
  cancelRun: () => void;
  clearCanvas: () => void;
  closePreview: () => void;
  copyJson: () => void;
  deleteArtifact: (artifactId: string) => void;
  deleteSelectedNode: () => void;
  downloadJson: () => void;
  importJsonChange: (event: ChangeEvent<HTMLInputElement>) => void;
  openWorkflowFile: () => void;
  openWorkflowPath?: (path: string) => void;
  previewArtifact: (artifact: WorkflowArtifact) => void;
  resetRuntime: () => void;
  runSelectedNode: () => void;
  runStep: () => void;
  runUntilBlocked: () => void;
  saveAsFile: () => void;
  saveFile: () => void;
};

export type WorkflowCanvasPanelsMeta = {
  filePath?: string;
  importInputRef: RefObject<HTMLInputElement | null>;
  recentWorkflowFiles: WorkflowRecentFile[];
};

type WorkflowCanvasPanelsContextValue = {
  actions: WorkflowCanvasPanelsActions;
  meta: WorkflowCanvasPanelsMeta;
  state: WorkflowCanvasPanelsState;
};

const WorkflowCanvasPanelsContext =
  createContext<WorkflowCanvasPanelsContextValue | null>(null);

export function WorkflowCanvasPanelsProvider({
  actions,
  children,
  meta,
  state,
}: WorkflowCanvasPanelsContextValue & { children: ReactNode }) {
  return (
    <WorkflowCanvasPanelsContext.Provider value={{ actions, meta, state }}>
      {children}
    </WorkflowCanvasPanelsContext.Provider>
  );
}

function useWorkflowCanvasPanels(): WorkflowCanvasPanelsContextValue {
  const context = use(WorkflowCanvasPanelsContext);
  if (!context) {
    throw new Error(
      "WorkflowCanvasPanels must be used within WorkflowCanvasPanelsProvider",
    );
  }
  return context;
}

function WorkflowNodePalettePanel() {
  const {
    actions: { addNode, clearCanvas, deleteSelectedNode },
    state: { document, selectedNodeId },
  } = useWorkflowCanvasPanels();

  return (
    <Panel
      position="top-left"
      className="rounded-lg border border-border/60 bg-card/95 p-2 text-card-foreground shadow-lg backdrop-blur"
    >
      <div className="mb-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
        Add node
      </div>
      <div className="grid grid-cols-2 gap-1">
        {nodePalette.map((item) => (
          <Button
            key={item.type}
            type="button"
            size="sm"
            variant="secondary"
            className="nodrag nowheel h-7 px-2 text-xs"
            onClick={() => addNode(item.type)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 border-border/60 border-t pt-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="nodrag nowheel h-7 px-2 text-xs"
          data-testid="workflow-delete-selected-node"
          disabled={!selectedNodeId}
          onClick={deleteSelectedNode}
        >
          Delete selected
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="nodrag nowheel h-7 px-2 text-xs"
          data-testid="workflow-clear-canvas"
          disabled={document.nodes.length === 0}
          onClick={clearCanvas}
        >
          Clear canvas
        </Button>
      </div>
    </Panel>
  );
}

function WorkflowRuntimePanel() {
  const {
    actions: {
      artifactActionError,
      artifactMaterialized,
      cancelRun,
      deleteArtifact,
      previewArtifact,
      resetRuntime,
      runSelectedNode,
      runStep,
      runUntilBlocked,
    },
    meta: { filePath },
    state: {
      document,
      readyNodeCount,
      safeReadyNodeCount,
      selectedNodeRunAvailable,
      workflowRunning,
    },
  } = useWorkflowCanvasPanels();

  return (
    <Panel
      position="top-right"
      className="rounded-lg border border-border/60 bg-card/95 p-2 text-card-foreground shadow-lg backdrop-blur"
    >
      <div className="mb-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
        Runtime
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="nodrag nowheel h-7 px-2 text-xs"
          disabled={workflowRunning || safeReadyNodeCount === 0}
          title="Run ready safe nodes. Shell, agent, file, and browser nodes require Run selected and approval."
          onClick={runUntilBlocked}
        >
          {workflowRunning ? "Running" : "Run safe"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="nodrag nowheel h-7 px-2 text-xs"
          disabled={workflowRunning || safeReadyNodeCount === 0}
          title="Run one ready safe step."
          onClick={runStep}
        >
          Step safe
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="nodrag nowheel h-7 px-2 text-xs"
          disabled={workflowRunning || !selectedNodeRunAvailable}
          title="Run only the selected node. Unsafe nodes will stop for approval first."
          onClick={runSelectedNode}
        >
          Run selected
        </Button>
        {workflowRunning ? (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="nodrag nowheel h-7 px-2 text-xs"
            onClick={cancelRun}
          >
            Cancel
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="nodrag nowheel h-7 px-2 text-xs"
          disabled={workflowRunning}
          onClick={resetRuntime}
        >
          Reset
        </Button>
        <Badge variant="secondary" className="text-[10px]">
          {safeReadyNodeCount} safe ready
        </Badge>
        {readyNodeCount !== safeReadyNodeCount ? (
          <Badge variant="outline" className="text-[10px]">
            {readyNodeCount - safeReadyNodeCount} need approval
          </Badge>
        ) : null}
        <Badge variant="outline" className="text-[10px]">
          {document.artifacts.length} artifacts
        </Badge>
      </div>
      {document.artifacts.length > 0 ? (
        <ArtifactList
          artifacts={document.artifacts.slice(-3)}
          compact
          onActionError={artifactActionError}
          onArtifactMaterialized={artifactMaterialized}
          onDeleteArtifact={deleteArtifact}
          onPreviewArtifact={previewArtifact}
          workflowDocumentId={document.id}
          workflowFilePath={filePath}
        />
      ) : null}
    </Panel>
  );
}

function WorkflowJsonPanel() {
  const {
    actions: {
      copyJson,
      downloadJson,
      importJsonChange,
      openWorkflowFile,
      openWorkflowPath,
      saveAsFile,
      saveFile,
    },
    meta: { filePath, importInputRef, recentWorkflowFiles },
    state: { dirty, saveAsUnavailable, savingFile, workflowIoMessage },
  } = useWorkflowCanvasPanels();

  return (
    <Panel
      position="bottom-left"
      className="rounded-lg border border-border/60 bg-card/95 p-2 text-card-foreground shadow-lg backdrop-blur"
    >
      <div className="mb-2 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
        Workflow JSON
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="default"
          className="nodrag nowheel h-7 px-2 text-xs"
          disabled={!filePath || savingFile || !dirty}
          onClick={saveFile}
        >
          {savingFile ? "Saving" : "Save"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="nodrag nowheel h-7 px-2 text-xs"
          disabled={savingFile || saveAsUnavailable}
          onClick={saveAsFile}
        >
          Save as
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="nodrag nowheel h-7 px-2 text-xs"
          onClick={copyJson}
        >
          Copy
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="nodrag nowheel h-7 px-2 text-xs"
          onClick={downloadJson}
        >
          Download
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="nodrag nowheel h-7 px-2 text-xs"
          onClick={openWorkflowFile}
        >
          Open
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="nodrag nowheel h-7 px-2 text-xs"
          onClick={() => importInputRef.current?.click()}
        >
          Import
        </Button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={importJsonChange}
        />
      </div>
      <div className="mt-2 max-w-64 truncate text-muted-foreground text-xs">
        {filePath
          ? `${dirty ? "Unsaved" : "Saved"}: ${pathBasename(filePath)}`
          : "Use Save as or Download for a new workflow file"}
      </div>
      {recentWorkflowFiles.length > 0 ? (
        <div className="mt-2 max-w-64 border-border/60 border-t pt-2">
          <div className="mb-1 text-muted-foreground text-[10px] uppercase tracking-wide">
            Recent
          </div>
          <div className="flex flex-wrap gap-1">
            {recentWorkflowFiles.slice(0, 3).map((recent) => (
              <Button
                key={recent.path}
                type="button"
                size="sm"
                variant="ghost"
                className="nodrag nowheel h-6 max-w-28 truncate px-2 text-xs"
                onClick={() => openWorkflowPath?.(recent.path)}
              >
                {recent.title || pathBasename(recent.path)}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      {workflowIoMessage ? (
        <div className="mt-1 max-w-64 truncate text-muted-foreground text-xs">
          {workflowIoMessage}
        </div>
      ) : null}
    </Panel>
  );
}

function WorkflowArtifactPreviewLayer() {
  const {
    actions: { closePreview, deleteArtifact },
    state: { previewArtifact },
  } = useWorkflowCanvasPanels();

  return previewArtifact ? (
    <ArtifactPreviewModal
      artifact={previewArtifact}
      onClose={closePreview}
      onDelete={() => deleteArtifact(previewArtifact.id)}
    />
  ) : null;
}

function WorkflowCanvasPanelsRoot() {
  return (
    <>
      <WorkflowCanvasPanels.NodePalette />
      <WorkflowCanvasPanels.Runtime />
      <WorkflowCanvasPanels.Json />
      <WorkflowCanvasPanels.Preview />
    </>
  );
}

export const WorkflowCanvasPanels = Object.assign(WorkflowCanvasPanelsRoot, {
  Json: WorkflowJsonPanel,
  NodePalette: WorkflowNodePalettePanel,
  Preview: WorkflowArtifactPreviewLayer,
  Runtime: WorkflowRuntimePanel,
});
