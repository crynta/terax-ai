import { Panel } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import type { WorkflowDocument } from "../lib/schema";
import {
  loadWorkflowVersionList,
  loadWorkflowVersionDocument,
  deleteWorkflowVersion,
  type WorkflowVersionSnapshot,
} from "../lib/versionSnapshots";
import {
  diffWorkflowDocuments,
  summarizeStructureDiff,
} from "../lib/structureDiff";
import { useState, useCallback } from "react";

export function WorkflowVersionsPanel({
  document,
  onRestore,
  onClose,
}: {
  document: WorkflowDocument;
  onRestore: (doc: WorkflowDocument) => void;
  onClose: () => void;
}) {
  const versions = loadWorkflowVersionList(document.id);
  const [compareFrom, setCompareFrom] = useState<string | null>(null);
  const [diffSummary, setDiffSummary] = useState<string | null>(null);

  const handleRestore = useCallback(
    (versionId: string) => {
      const loaded = loadWorkflowVersionDocument(versionId);
      if (loaded) onRestore(loaded);
    },
    [onRestore],
  );

  const handleDelete = useCallback(
    (versionId: string) => {
      deleteWorkflowVersion(document.id, versionId);
    },
    [document.id],
  );

  const handleCompare = useCallback(
    (versionId: string) => {
      if (!compareFrom) {
        setCompareFrom(versionId);
        setDiffSummary(null);
        return;
      }
      const left = loadWorkflowVersionDocument(compareFrom);
      const right = loadWorkflowVersionDocument(versionId);
      if (left && right) {
        const diff = diffWorkflowDocuments(left, right);
        setDiffSummary(summarizeStructureDiff(diff));
      }
      setCompareFrom(null);
    },
    [compareFrom],
  );

  return (
    <Panel
      position="bottom-right"
      className="z-50 m-2 flex max-h-[60vh] w-80 flex-col rounded-lg border border-border/60 bg-card/95 text-card-foreground shadow-xl backdrop-blur"
    >
      <div className="flex shrink-0 items-center justify-between border-border/40 border-b p-3">
        <div className="font-medium text-sm">Version History</div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={onClose}
        >
          ✕
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {versions.length === 0 ? (
          <div className="text-muted-foreground text-xs italic">
            No versions saved yet. Click "Version" to save one.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {versions.map((v) => (
              <VersionCard
                key={v.id}
                version={v}
                isSelected={compareFrom === v.id}
                onRestore={() => handleRestore(v.id)}
                onDelete={() => handleDelete(v.id)}
                onCompare={() => handleCompare(v.id)}
              />
            ))}
          </div>
        )}

        {diffSummary && (
          <div className="mt-3 rounded border border-border/40 bg-muted/20 p-2 text-xs">
            <div className="text-muted-foreground text-[10px] uppercase tracking-wide mb-1">
              Diff
            </div>
            {diffSummary}
          </div>
        )}
      </div>
    </Panel>
  );
}

function VersionCard({
  version,
  isSelected,
  onRestore,
  onDelete,
  onCompare,
}: {
  version: WorkflowVersionSnapshot;
  isSelected: boolean;
  onRestore: () => void;
  onDelete: () => void;
  onCompare: () => void;
}) {
  return (
    <div
      className={`rounded border px-2 py-1.5 text-xs ${
        isSelected
          ? "border-primary/40 bg-primary/5"
          : "border-border/40 bg-background/30"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{version.label}</span>
        <span className="text-muted-foreground text-[10px]">
          {new Date(version.savedAt).toLocaleTimeString()}
        </span>
      </div>
      <div className="text-muted-foreground text-[10px]">
        {version.nodeCount} nodes · {version.edgeCount} edges
      </div>
      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/20"
          onClick={onRestore}
        >
          Restore
        </button>
        <button
          type="button"
          className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/80"
          onClick={onCompare}
        >
          Compare
        </button>
        <button
          type="button"
          className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive hover:bg-destructive/20"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
