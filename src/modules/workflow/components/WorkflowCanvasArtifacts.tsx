import { save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  describeWorkflowArtifactPreview,
  persistWorkflowArtifactBinaryFile,
  workflowArtifactPreviewDetails,
  workflowArtifactStorageDirectory,
} from "../lib/artifactStorage";
import type { WorkflowInspectorState } from "../lib/inspector";
import {
  tauriWorkflowArtifactFileSystem,
  workflowArtifactNativePreviewSource,
} from "../lib/nativeArtifactStorage";
import type {
  WorkflowArtifact,
  WorkflowDocument,
  WorkflowNode,
} from "../lib/schema";

export function safeArtifactPreviewSource(source: string): string {
  try {
    return workflowArtifactNativePreviewSource(source);
  } catch {
    return source;
  }
}

export function artifactPreviewActionSource(
  artifact: WorkflowArtifact,
): string | null {
  const preview = describeWorkflowArtifactPreview(artifact);
  if ("source" in preview) return preview.source;
  return artifact.storage?.path ?? null;
}

export function artifactStoredPath(artifact: WorkflowArtifact): string | null {
  return artifact.storage?.kind === "file" && artifact.storage.path
    ? artifact.storage.path
    : null;
}

type WorkflowArtifactFileActionOptions = {
  documentId: string;
  workflowFilePath?: string;
  onArtifactMaterialized?: (artifact: WorkflowArtifact) => void;
};

export function replaceWorkflowArtifact(
  document: WorkflowDocument,
  artifact: WorkflowArtifact,
): WorkflowDocument {
  if (!document.artifacts.some((candidate) => candidate.id === artifact.id)) {
    return document;
  }
  return {
    ...document,
    artifacts: document.artifacts.map((candidate) =>
      candidate.id === artifact.id ? artifact : candidate,
    ),
  };
}

async function openWorkflowArtifact(
  artifact: WorkflowArtifact,
  options: WorkflowArtifactFileActionOptions,
): Promise<void> {
  const fileArtifact = await ensureWorkflowArtifactFile(artifact, {
    ...options,
    promptTitle: "Save artifact to open",
  });
  if (!fileArtifact) return;
  const storedPath = artifactStoredPath(fileArtifact);
  if (!storedPath) throw new Error("Artifact has no openable file path");
  await openWorkflowArtifactPath(storedPath);
}

async function openWorkflowArtifactPath(path: string): Promise<void> {
  if (!tauriWorkflowArtifactFileSystem.openFile) {
    await revealItemInDir(path);
    return;
  }
  try {
    await tauriWorkflowArtifactFileSystem.openFile(path);
  } catch {
    await revealItemInDir(path);
  }
}

async function revealWorkflowArtifact(
  artifact: WorkflowArtifact,
  options: WorkflowArtifactFileActionOptions,
): Promise<void> {
  const fileArtifact = await ensureWorkflowArtifactFile(artifact, {
    ...options,
    promptTitle: "Save artifact to reveal",
  });
  if (!fileArtifact) return;
  const storedPath = artifactStoredPath(fileArtifact);
  if (!storedPath) throw new Error("Artifact has no revealable file path");
  await revealItemInDir(storedPath);
}

async function copyWorkflowArtifactPath(
  artifact: WorkflowArtifact,
  options: WorkflowArtifactFileActionOptions,
): Promise<void> {
  const fileArtifact = await ensureWorkflowArtifactFile(artifact, {
    ...options,
    promptTitle: "Save artifact to copy its path",
  });
  if (!fileArtifact) return;
  const storedPath = artifactStoredPath(fileArtifact);
  if (!storedPath) throw new Error("Artifact has no copyable file path");
  await copyArtifactPath(storedPath);
}

async function ensureWorkflowArtifactFile(
  artifact: WorkflowArtifact,
  options: WorkflowArtifactFileActionOptions & { promptTitle: string },
): Promise<WorkflowArtifact | null> {
  if (artifactStoredPath(artifact)) return artifact;
  const source = artifactPreviewActionSource(artifact);
  if (!source) throw new Error("Artifact has no file source");

  let materialized: WorkflowArtifact | null = null;
  if (options.workflowFilePath) {
    materialized = await persistWorkflowArtifactBinaryFile(artifact, {
      baseDirectory: workflowArtifactStorageDirectory({
        workflowFilePath: options.workflowFilePath,
        documentId: options.documentId,
      }),
      fileSystem: tauriWorkflowArtifactFileSystem,
    });
  } else {
    materialized = await saveWorkflowArtifactAsFile(artifact, {
      title: options.promptTitle,
      source: "workflow-artifact-materialize",
    });
  }

  if (materialized) options.onArtifactMaterialized?.(materialized);
  return materialized;
}

async function copyArtifactPath(value: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  await navigator.clipboard.writeText(value);
}

async function exportWorkflowArtifact(
  artifact: WorkflowArtifact,
): Promise<WorkflowArtifact | null> {
  return saveWorkflowArtifactAsFile(artifact, {
    title: "Export workflow artifact",
    source: "workflow-artifact-export",
    updateStorage: !artifactStoredPath(artifact),
  });
}

async function saveWorkflowArtifactAsFile(
  artifact: WorkflowArtifact,
  {
    source,
    title,
    updateStorage = true,
  }: { source: string; title: string; updateStorage?: boolean },
): Promise<WorkflowArtifact | null> {
  const extension = artifactExportExtension(artifact);
  const selectedPath = await save({
    title,
    defaultPath: artifactDownloadFilename(artifact),
    filters: artifactExportFilters(artifact),
  });
  if (!selectedPath) return null;
  const path = ensureArtifactExportExtension(selectedPath, extension);
  await writeWorkflowArtifactToPath(artifact, path, source);
  return updateStorage ? workflowArtifactWithFileStorage(artifact, path) : null;
}

async function writeWorkflowArtifactToPath(
  artifact: WorkflowArtifact,
  path: string,
  source: string,
): Promise<void> {
  const dataUrl = parseArtifactDataUrl(artifact.preview);
  if (dataUrl && tauriWorkflowArtifactFileSystem.writeBase64File) {
    await tauriWorkflowArtifactFileSystem.writeBase64File(
      path,
      dataUrl.contentBase64,
      source,
    );
    return;
  }

  const storedPath = artifactStoredPath(artifact);
  if (storedPath && tauriWorkflowArtifactFileSystem.copyFile) {
    await tauriWorkflowArtifactFileSystem.copyFile(storedPath, path, source);
    return;
  }

  if (isInlineArtifactSource(artifact.preview)) {
    throw new Error("Artifact data URL is not base64 encoded");
  }
  await tauriWorkflowArtifactFileSystem.writeFile(
    path,
    artifact.preview,
    source,
  );
}

export function workflowArtifactWithFileStorage(
  artifact: WorkflowArtifact,
  path: string,
): WorkflowArtifact {
  const dataUrl = parseArtifactDataUrl(artifact.preview);
  const mediaType = artifactActionMediaType(artifact);
  return {
    ...artifact,
    storage: {
      kind: "file",
      path,
      ...(mediaType ? { mediaType } : {}),
      ...(dataUrl ? { byteLength: dataUrl.byteLength } : {}),
      ...(mediaType?.startsWith("image/") && !mediaType.includes("svg")
        ? { thumbnailPath: path }
        : {}),
    },
  };
}

export function artifactExportFilters(
  artifact: WorkflowArtifact,
): Array<{ name: string; extensions: string[] }> {
  return [
    {
      name: `${artifact.type.toUpperCase()} artifact`,
      extensions: [artifactExportExtension(artifact)],
    },
  ];
}

export function parseArtifactDataUrl(
  value: string,
): { mediaType: string; contentBase64: string; byteLength: number } | null {
  const match = /^data:([^,]*),([\s\S]*)$/i.exec(value);
  if (!match) return null;
  const metadata = match[1] ?? "";
  if (!metadata.toLowerCase().split(";").includes("base64")) return null;
  const contentBase64 = (match[2] ?? "").replace(/\s+/g, "");
  return {
    mediaType: metadata.split(";")[0]?.trim() || "application/octet-stream",
    contentBase64,
    byteLength: base64ByteLength(contentBase64),
  };
}

export function isInlineArtifactSource(source: string): boolean {
  return /^(data:|blob:)/i.test(source);
}

export function base64ByteLength(contentBase64: string): number {
  const normalized = contentBase64.replace(/=+$/, "");
  const padding = contentBase64.length - normalized.length;
  return Math.max(0, Math.floor((contentBase64.length * 3) / 4) - padding);
}

export function artifactDownloadFilename(artifact: WorkflowArtifact): string {
  return `${safeFilename(artifact.label || artifact.id)}.${artifactExportExtension(artifact)}`;
}

export function artifactExportExtension(artifact: WorkflowArtifact): string {
  return artifactFileExtension(
    artifact.type,
    artifactActionMediaType(artifact),
  );
}

export function artifactActionMediaType(
  artifact: WorkflowArtifact,
): string | undefined {
  return (
    artifact.storage?.mediaType ??
    parseArtifactDataUrl(artifact.preview)?.mediaType
  );
}

export function ensureArtifactExportExtension(
  path: string,
  extension: string,
): string {
  return path.toLowerCase().endsWith(`.${extension.toLowerCase()}`)
    ? path
    : `${path}.${extension}`;
}

export function artifactFileExtension(
  type: WorkflowArtifact["type"],
  mediaType?: string,
): string {
  if (mediaType?.includes("png")) return "png";
  if (mediaType?.includes("svg")) return "svg";
  if (mediaType?.includes("jpeg") || mediaType?.includes("jpg")) return "jpg";
  if (mediaType?.includes("webp")) return "webp";
  if (mediaType?.includes("mp4")) return "mp4";
  if (mediaType?.includes("mpeg")) return "mp3";
  if (mediaType?.includes("wav")) return "wav";
  if (type === "json") return "json";
  if (type === "image") return "png";
  if (type === "video") return "mp4";
  if (type === "audio") return "mp3";
  return "txt";
}

export function artifactActionErrorMessage(error: unknown): string {
  return error instanceof Error
    ? `Artifact action failed: ${error.message}`
    : "Artifact action failed";
}

export function approvalActionText(
  action: NonNullable<
    NonNullable<WorkflowInspectorState["selectedNode"]>["approval"]
  >["action"],
): string {
  if (action.kind === "shell") return action.command;
  if (action.kind === "agent") return action.prompt;
  if (action.kind === "file") return `${action.operation} ${action.path}`;
  return `${action.url} - ${action.instructions}`;
}

export function formatPercent(value: number): string {
  const clamped = Math.min(Math.max(value, 0), 1);
  return `${Math.round(clamped * 100)}%`;
}

export function formatLogTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return value;
  return timestamp.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function safeFilename(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "workflow"
  );
}

export function artifactsForFlowNode(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowArtifact[] {
  const runtimeArtifactIds = new Set(node.runtimeState.artifactIds ?? []);
  return document.artifacts.filter(
    (artifact) =>
      artifact.nodeId === node.id || runtimeArtifactIds.has(artifact.id),
  );
}

export function ArtifactList({
  artifacts,
  compact = false,
  onActionError,
  onArtifactMaterialized,
  onDeleteArtifact,
  onPreviewArtifact,
  workflowDocumentId,
  workflowFilePath,
}: {
  artifacts: WorkflowArtifact[];
  compact?: boolean;
  onActionError?: (error: unknown) => void;
  onArtifactMaterialized?: (artifact: WorkflowArtifact) => void;
  onDeleteArtifact?: (artifactId: string) => void;
  onPreviewArtifact?: (artifact: WorkflowArtifact) => void;
  workflowDocumentId: string;
  workflowFilePath?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-md border border-border/60 bg-muted/20 p-2",
        compact && "mt-2 max-w-72",
      )}
    >
      {artifacts.map((artifact) => (
        <div key={artifact.id} className="min-w-0 rounded bg-background/70 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium text-xs">
              {artifact.label}
            </span>
            <Badge variant="secondary" className="shrink-0 text-[10px]">
              {artifact.type}
            </Badge>
          </div>
          <ArtifactPreview artifact={artifact} />
          <ArtifactPreviewDetails artifact={artifact} />
          <ArtifactActions
            artifact={artifact}
            onActionError={onActionError}
            onArtifactMaterialized={onArtifactMaterialized}
            onDeleteArtifact={onDeleteArtifact}
            onPreviewArtifact={onPreviewArtifact}
            workflowDocumentId={workflowDocumentId}
            workflowFilePath={workflowFilePath}
          />
        </div>
      ))}
    </div>
  );
}

export function ArtifactPreviewModal({
  artifact,
  onClose,
  onDelete,
}: {
  artifact: WorkflowArtifact;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-3rem)] max-w-4xl gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        <DialogHeader className="flex-row items-center justify-between gap-3 border-border border-b px-4 py-3">
          <div className="min-w-0">
            <DialogTitle className="text-sm">Artifact preview</DialogTitle>
            <DialogDescription className="truncate text-xs">
              {artifact.label}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-7 px-2 text-xs"
              onClick={onDelete}
            >
              Delete
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={onClose}
            >
              Close preview
            </Button>
          </div>
        </DialogHeader>
        <div className="overflow-auto p-4">
          <ArtifactPreview artifact={artifact} expanded />
          <ArtifactPreviewDetails artifact={artifact} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ArtifactPreviewDetails({
  artifact,
}: {
  artifact: WorkflowArtifact;
}) {
  const details = workflowArtifactPreviewDetails(artifact);
  if (details.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {details.map((detail) => (
        <span
          key={detail}
          className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-[10px]"
        >
          {detail}
        </span>
      ))}
    </div>
  );
}

export function ArtifactActions({
  artifact,
  onActionError,
  onArtifactMaterialized,
  onDeleteArtifact,
  onPreviewArtifact,
  workflowDocumentId,
  workflowFilePath,
}: {
  artifact: WorkflowArtifact;
  onActionError?: (error: unknown) => void;
  onArtifactMaterialized?: (artifact: WorkflowArtifact) => void;
  onDeleteArtifact?: (artifactId: string) => void;
  onPreviewArtifact?: (artifact: WorkflowArtifact) => void;
  workflowDocumentId: string;
  workflowFilePath?: string;
}) {
  const source = artifactPreviewActionSource(artifact);
  const storedPath = artifactStoredPath(artifact);
  if (!source && !storedPath && !onPreviewArtifact && !onDeleteArtifact) {
    return null;
  }
  const fileActionOptions = {
    documentId: workflowDocumentId,
    onArtifactMaterialized,
    workflowFilePath,
  };
  const runAction = (action: () => Promise<void> | void) => {
    void Promise.resolve()
      .then(action)
      .catch((error) => onActionError?.(error));
  };
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {onPreviewArtifact ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="nodrag nowheel h-6 px-2 text-[10px]"
          onClick={() => onPreviewArtifact(artifact)}
        >
          Preview
        </Button>
      ) : null}
      {source || storedPath ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="nodrag nowheel h-6 px-2 text-[10px]"
          onClick={() =>
            runAction(() => openWorkflowArtifact(artifact, fileActionOptions))
          }
        >
          Open
        </Button>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="nodrag nowheel h-6 px-2 text-[10px]"
        disabled={!source && !storedPath}
        title={
          storedPath
            ? "Reveal artifact file"
            : "Save artifact to a file, then reveal it"
        }
        onClick={() =>
          runAction(() => revealWorkflowArtifact(artifact, fileActionOptions))
        }
      >
        Reveal
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="nodrag nowheel h-6 px-2 text-[10px]"
        disabled={!source && !storedPath}
        onClick={() =>
          runAction(() => copyWorkflowArtifactPath(artifact, fileActionOptions))
        }
      >
        Copy path
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="nodrag nowheel h-6 px-2 text-[10px]"
        onClick={() =>
          runAction(async () => {
            const materialized = await exportWorkflowArtifact(artifact);
            if (materialized) onArtifactMaterialized?.(materialized);
          })
        }
      >
        Export
      </Button>
      {onDeleteArtifact ? (
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="nodrag nowheel h-6 px-2 text-[10px]"
          onClick={() => onDeleteArtifact(artifact.id)}
        >
          Delete
        </Button>
      ) : null}
    </div>
  );
}

export function ArtifactPreview({
  artifact,
  expanded = false,
}: {
  artifact: WorkflowArtifact;
  expanded?: boolean;
}) {
  const preview = describeWorkflowArtifactPreview(artifact);
  const source =
    "source" in preview ? safeArtifactPreviewSource(preview.source) : null;

  if (preview.kind === "image" && source) {
    return (
      <img
        src={source}
        alt={preview.text}
        width={1024}
        height={768}
        className={cn(
          "nodrag nowheel mt-2 w-full rounded-md border border-border/60 object-contain",
          expanded ? "max-h-[70vh]" : "max-h-32",
        )}
        loading="lazy"
      />
    );
  }
  if (preview.kind === "video" && source) {
    return (
      <video
        src={source}
        className={cn(
          "nodrag nowheel mt-2 w-full rounded-md border border-border/60 bg-black",
          expanded ? "max-h-[70vh]" : "max-h-32",
        )}
        controls
      />
    );
  }
  if (preview.kind === "audio" && source) {
    return (
      <audio src={source} className="nodrag nowheel mt-2 w-full" controls />
    );
  }
  if (preview.kind === "file" && source) {
    return (
      <div className="mt-1 truncate font-mono text-muted-foreground text-[10px]">
        {source}
      </div>
    );
  }
  return (
    <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-muted-foreground text-xs">
      {preview.text}
    </div>
  );
}
