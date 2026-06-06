import type { ChangeEvent, RefObject } from "react";
import { Panel } from "@xyflow/react";
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

type WorkflowCanvasPanelsProps = {
  dirty: boolean;
  document: WorkflowDocument;
  filePath?: string;
  importInputRef: RefObject<HTMLInputElement | null>;
  previewArtifact: WorkflowArtifact | null;
  readyNodeCount: number;
  recentWorkflowFiles: WorkflowRecentFile[];
  savingFile: boolean;
  selectedNodeId: string | null;
  workflowIoMessage: string | null;
  workflowRunning: boolean;
  onAddNode: (type: WorkflowNodeType) => void;
  onArtifactActionError: (error: unknown) => void;
  onArtifactMaterialized: (artifact: WorkflowArtifact) => void;
  onCancelRun: () => void;
  onClearCanvas: () => void;
  onClosePreview: () => void;
  onCopyJson: () => void;
  onDeleteArtifact: (artifactId: string) => void;
  onDeleteSelectedNode: () => void;
  onDownloadJson: () => void;
  onImportJsonChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onOpenWorkflowFile: () => void;
  onOpenWorkflowPath?: (path: string) => void;
  onPreviewArtifact: (artifact: WorkflowArtifact) => void;
  onResetRuntime: () => void;
  onRunStep: () => void;
  onRunUntilBlocked: () => void;
  onSaveAsFile: () => void;
  onSaveAsUnavailable: boolean;
  onSaveFile: () => void;
};

export function WorkflowCanvasPanels({
  dirty,
  document,
  filePath,
  importInputRef,
  previewArtifact,
  readyNodeCount,
  recentWorkflowFiles,
  savingFile,
  selectedNodeId,
  workflowIoMessage,
  workflowRunning,
  onAddNode,
  onArtifactActionError,
  onArtifactMaterialized,
  onCancelRun,
  onClearCanvas,
  onClosePreview,
  onCopyJson,
  onDeleteArtifact,
  onDeleteSelectedNode,
  onDownloadJson,
  onImportJsonChange,
  onOpenWorkflowFile,
  onOpenWorkflowPath,
  onPreviewArtifact,
  onResetRuntime,
  onRunStep,
  onRunUntilBlocked,
  onSaveAsFile,
  onSaveAsUnavailable,
  onSaveFile,
}: WorkflowCanvasPanelsProps) {
  return (
    <>
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
              onClick={() => onAddNode(item.type)}
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
            onClick={onDeleteSelectedNode}
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
            onClick={onClearCanvas}
          >
            Clear canvas
          </Button>
        </div>
      </Panel>

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
            disabled={workflowRunning || readyNodeCount === 0}
            onClick={onRunUntilBlocked}
          >
            {workflowRunning ? "Running" : "Run safe"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="nodrag nowheel h-7 px-2 text-xs"
            disabled={workflowRunning || readyNodeCount === 0}
            onClick={onRunStep}
          >
            Step
          </Button>
          {workflowRunning ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="nodrag nowheel h-7 px-2 text-xs"
              onClick={onCancelRun}
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
            onClick={onResetRuntime}
          >
            Reset
          </Button>
          <Badge variant="secondary" className="text-[10px]">
            {readyNodeCount} ready
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {document.artifacts.length} artifacts
          </Badge>
        </div>
        {document.artifacts.length > 0 ? (
          <ArtifactList
            artifacts={document.artifacts.slice(-3)}
            compact
            onActionError={onArtifactActionError}
            onArtifactMaterialized={onArtifactMaterialized}
            onDeleteArtifact={onDeleteArtifact}
            onPreviewArtifact={onPreviewArtifact}
            workflowDocumentId={document.id}
            workflowFilePath={filePath}
          />
        ) : null}
      </Panel>

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
            onClick={onSaveFile}
          >
            {savingFile ? "Saving" : "Save"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="nodrag nowheel h-7 px-2 text-xs"
            disabled={savingFile || onSaveAsUnavailable}
            onClick={onSaveAsFile}
          >
            Save as
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="nodrag nowheel h-7 px-2 text-xs"
            onClick={onCopyJson}
          >
            Copy
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="nodrag nowheel h-7 px-2 text-xs"
            onClick={onDownloadJson}
          >
            Download
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="nodrag nowheel h-7 px-2 text-xs"
            onClick={onOpenWorkflowFile}
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
            onChange={onImportJsonChange}
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
                  onClick={() => onOpenWorkflowPath?.(recent.path)}
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

      {previewArtifact ? (
        <ArtifactPreviewModal
          artifact={previewArtifact}
          onClose={onClosePreview}
          onDelete={() => onDeleteArtifact(previewArtifact.id)}
        />
      ) : null}
    </>
  );
}
