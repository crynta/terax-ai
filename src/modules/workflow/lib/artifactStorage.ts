import type {
  WorkflowArtifact,
  WorkflowDocument,
  WorkflowNode,
  WorkflowPortType,
} from "./schema";

export type WorkflowArtifactFileSystem = {
  createDirectory?: (path: string) => Promise<void>;
  copyFile?: (from: string, to: string, source: string) => Promise<void>;
  openFile?: (path: string) => Promise<void>;
  writeFile: (path: string, content: string, source: string) => Promise<void>;
  writeBase64File?: (
    path: string,
    contentBase64: string,
    source: string,
  ) => Promise<void>;
};

export type WorkflowArtifactStoragePathInput = {
  baseDirectory: string;
  artifact: Pick<WorkflowArtifact, "id" | "type">;
};

export type PersistWorkflowArtifactFileOptions = {
  baseDirectory: string;
  fileSystem: WorkflowArtifactFileSystem;
  thumbnailPath?: string;
};

export type WorkflowArtifactBinaryStoragePathInput = {
  baseDirectory: string;
  artifact: Pick<WorkflowArtifact, "id" | "type">;
  mediaType?: string;
};

export type WorkflowArtifactStorageDirectoryInput = {
  workflowFilePath: string;
  documentId: string;
};

export type WorkflowArtifactGalleryOptions = {
  types?: WorkflowPortType[];
  nodeIds?: string[];
  limit?: number;
  newestFirst?: boolean;
};

export type WorkflowArtifactPreviewDescriptor =
  | { kind: "image" | "video" | "audio" | "file"; source: string; text: string }
  | { kind: "text"; text: string };

export function workflowArtifactStoragePath({
  baseDirectory,
  artifact,
}: WorkflowArtifactStoragePathInput): string {
  return `${trimTrailingSlash(baseDirectory)}/${safeArtifactPathSegment(
    artifact.id,
  )}.${artifact.type}.json`;
}

export function workflowArtifactBinaryStoragePath({
  baseDirectory,
  artifact,
  mediaType,
}: WorkflowArtifactBinaryStoragePathInput): string {
  return `${trimTrailingSlash(baseDirectory)}/${safeArtifactPathSegment(
    artifact.id,
  )}.${artifactFileExtension(artifact.type, mediaType)}`;
}

export function workflowArtifactStorageDirectory({
  workflowFilePath,
  documentId,
}: WorkflowArtifactStorageDirectoryInput): string {
  const directory = pathDirname(workflowFilePath);
  const storageRoot = directory
    ? `${directory}/.terax-workflow-artifacts`
    : ".terax-workflow-artifacts";
  return `${storageRoot}/${safeArtifactPathSegment(documentId)}`;
}

export async function persistWorkflowArtifactFile(
  artifact: WorkflowArtifact,
  options: PersistWorkflowArtifactFileOptions,
): Promise<WorkflowArtifact> {
  await options.fileSystem.createDirectory?.(options.baseDirectory);
  const path = workflowArtifactStoragePath({
    baseDirectory: options.baseDirectory,
    artifact,
  });
  const content = `${JSON.stringify(artifactEnvelope(artifact), null, 2)}\n`;
  await options.fileSystem.writeFile(path, content, "workflow-artifact");

  return {
    ...artifact,
    storage: {
      kind: "file",
      path,
      mediaType: "application/json",
      byteLength: byteLength(content),
      ...(options.thumbnailPath
        ? { thumbnailPath: options.thumbnailPath }
        : {}),
    },
  };
}

export async function persistWorkflowArtifactBinaryFile(
  artifact: WorkflowArtifact,
  options: PersistWorkflowArtifactFileOptions,
): Promise<WorkflowArtifact> {
  const dataUrl = parseWorkflowDataUrl(artifact.preview);
  if (!dataUrl || !options.fileSystem.writeBase64File) {
    return persistWorkflowArtifactFile(artifact, options);
  }

  await options.fileSystem.createDirectory?.(options.baseDirectory);
  const path = workflowArtifactBinaryStoragePath({
    baseDirectory: options.baseDirectory,
    artifact,
    mediaType: dataUrl.mediaType,
  });
  await options.fileSystem.writeBase64File(
    path,
    dataUrl.contentBase64,
    "workflow-artifact-binary",
  );

  return {
    ...artifact,
    preview: isSvgMediaType(dataUrl.mediaType) ? artifact.preview : path,
    storage: {
      kind: "file",
      path,
      mediaType: dataUrl.mediaType,
      byteLength: dataUrl.byteLength,
      ...(isImageMediaType(dataUrl.mediaType) &&
      !isSvgMediaType(dataUrl.mediaType)
        ? { thumbnailPath: path }
        : options.thumbnailPath
          ? { thumbnailPath: options.thumbnailPath }
          : {}),
    },
  };
}

export function collectWorkflowArtifactGallery(
  document: WorkflowDocument,
  options: WorkflowArtifactGalleryOptions = {},
): WorkflowArtifact[] {
  const types = new Set(options.types ?? []);
  const nodeIds = new Set(options.nodeIds ?? []);
  const artifacts = document.artifacts.filter((artifact) => {
    if (types.size > 0 && !types.has(artifact.type)) return false;
    if (nodeIds.size > 0 && !nodeIds.has(artifact.nodeId)) return false;
    return true;
  });
  const ordered = options.newestFirst ? [...artifacts].reverse() : artifacts;
  return options.limit && options.limit > 0
    ? ordered.slice(0, options.limit)
    : ordered;
}

export function collectReusableWorkflowArtifacts(
  document: WorkflowDocument,
  node: WorkflowNode,
): WorkflowArtifact[] {
  const acceptedTypes = new Set(node.inputs.map((input) => input.type));
  if (acceptedTypes.size === 0) return [];
  return document.artifacts.filter(
    (artifact) =>
      artifact.nodeId !== node.id && acceptedTypes.has(artifact.type),
  );
}

export function removeWorkflowArtifact(
  document: WorkflowDocument,
  artifactId: string,
): WorkflowDocument {
  if (!document.artifacts.some((artifact) => artifact.id === artifactId)) {
    return document;
  }

  return {
    ...document,
    artifacts: document.artifacts.filter(
      (artifact) => artifact.id !== artifactId,
    ),
    nodes: document.nodes.map((node) => {
      const artifactIds = node.runtimeState.artifactIds;
      if (!artifactIds?.includes(artifactId)) return node;

      const nextArtifactIds = artifactIds.filter((id) => id !== artifactId);
      const { artifactIds: _removed, ...runtimeState } = node.runtimeState;
      return {
        ...node,
        runtimeState:
          nextArtifactIds.length > 0
            ? { ...runtimeState, artifactIds: nextArtifactIds }
            : runtimeState,
      };
    }),
  };
}

export function describeWorkflowArtifactPreview(
  artifact: WorkflowArtifact,
): WorkflowArtifactPreviewDescriptor {
  const source = artifactPreviewSource(artifact);
  const text = artifact.preview || artifact.label;
  if (
    isMediaArtifact(artifact, "image") &&
    isRenderableMediaSource(artifact, "image", source)
  ) {
    return { kind: "image", source, text: artifact.label };
  }
  if (
    isMediaArtifact(artifact, "video") &&
    isRenderableMediaSource(artifact, "video", source)
  ) {
    return { kind: "video", source, text: artifact.label };
  }
  if (
    isMediaArtifact(artifact, "audio") &&
    isRenderableMediaSource(artifact, "audio", source)
  ) {
    return { kind: "audio", source, text: artifact.label };
  }
  if (artifact.type === "file" && source) {
    return { kind: "file", source, text };
  }
  return { kind: "text", text };
}

export function workflowArtifactPreviewDetails(
  artifact: WorkflowArtifact,
): string[] {
  const details: string[] = [];
  const mediaType = artifactMediaType(artifact);
  if (mediaType) details.push(mediaType);
  const length = artifactByteLength(artifact);
  if (length !== undefined) details.push(formatByteLength(length));

  const value = objectValue(artifact.value);
  const provider = stringValue(value?.provider);
  const model = stringValue(value?.model);
  if (provider && model) details.push(`${provider}:${model}`);
  else if (model) details.push(model);
  else if (provider) details.push(provider);

  const path = artifact.storage?.path;
  if (path) details.push(pathBasename(path));
  return details;
}

export function artifactPreviewSource(artifact: WorkflowArtifact): string {
  const previewDataUrl = parseWorkflowDataUrl(artifact.preview);
  if (previewDataUrl && isSvgMediaType(previewDataUrl.mediaType)) {
    return artifact.preview;
  }
  return (
    artifact.storage?.thumbnailPath ??
    artifact.storage?.path ??
    artifact.preview
  );
}

function artifactEnvelope(artifact: WorkflowArtifact): WorkflowArtifact {
  const { storage: _storage, ...portableArtifact } = artifact;
  return portableArtifact;
}

function artifactMediaType(artifact: WorkflowArtifact): string | undefined {
  return (
    artifact.storage?.mediaType ??
    parseWorkflowDataUrl(artifact.preview)?.mediaType
  );
}

function artifactByteLength(artifact: WorkflowArtifact): number | undefined {
  return (
    artifact.storage?.byteLength ??
    parseWorkflowDataUrl(artifact.preview)?.byteLength
  );
}

function formatByteLength(value: number): string {
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${trimTrailingZero(kb)} KB`;
  const mb = kb / 1024;
  return `${trimTrailingZero(mb)} MB`;
}

function trimTrailingZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function pathBasename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? (parts[parts.length - 1] ?? path) : path;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseWorkflowDataUrl(
  value: string,
): { mediaType: string; contentBase64: string; byteLength: number } | null {
  const match = /^data:([^,]*),([\s\S]*)$/i.exec(value);
  if (!match) return null;
  const metadata = match[1] ?? "";
  if (!metadata.toLowerCase().split(";").includes("base64")) return null;
  const mediaType =
    metadata.split(";")[0]?.trim() || "application/octet-stream";
  const contentBase64 = (match[2] ?? "").replace(/\s+/g, "");
  if (!contentBase64) return null;
  return {
    mediaType,
    contentBase64,
    byteLength: base64ByteLength(contentBase64),
  };
}

function base64ByteLength(contentBase64: string): number {
  const padding = contentBase64.endsWith("==")
    ? 2
    : contentBase64.endsWith("=")
      ? 1
      : 0;
  return Math.max(0, Math.floor((contentBase64.length * 3) / 4) - padding);
}

function artifactFileExtension(
  type: WorkflowPortType,
  mediaType: string | undefined,
): string {
  const normalized = mediaType?.toLowerCase().split(";")[0]?.trim();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/png") return "png";
  if (normalized === "image/svg+xml") return "svg";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  if (normalized === "video/mp4") return "mp4";
  if (normalized === "video/webm") return "webm";
  if (normalized === "audio/mpeg") return "mp3";
  if (normalized === "audio/mp4") return "m4a";
  if (normalized === "audio/wav" || normalized === "audio/x-wav") {
    return "wav";
  }
  if (type === "image") return "png";
  if (type === "video") return "mp4";
  if (type === "audio") return "wav";
  return "bin";
}

function isImageMediaType(mediaType: string): boolean {
  return mediaType.toLowerCase().startsWith("image/");
}

function isSvgMediaType(mediaType: string): boolean {
  return mediaType.toLowerCase().split(";")[0]?.trim() === "image/svg+xml";
}

function isMediaArtifact(
  artifact: WorkflowArtifact,
  type: "image" | "video" | "audio",
): boolean {
  return (
    artifact.type === type ||
    artifact.storage?.mediaType?.toLowerCase().startsWith(`${type}/`) === true
  );
}

function isRenderableMediaSource(
  artifact: WorkflowArtifact,
  type: "image" | "video" | "audio",
  source: string,
): boolean {
  const mediaType = artifactMediaType(artifact)?.toLowerCase();
  if (mediaType) return mediaType.startsWith(`${type}/`);
  if (/^data:/i.test(source))
    return source.toLowerCase().startsWith(`data:${type}/`);
  if (/^(blob:|https?:|file:|asset:)/i.test(source)) return true;
  return mediaExtensionPattern(type).test(source);
}

function mediaExtensionPattern(type: "image" | "video" | "audio"): RegExp {
  if (type === "image") return /\.(png|jpe?g|webp|gif|svg)(?:[?#].*)?$/i;
  if (type === "video") return /\.(mp4|webm|mov|m4v)(?:[?#].*)?$/i;
  return /\.(mp3|m4a|wav|aac|flac|opus|ogg)(?:[?#].*)?$/i;
}

function trimTrailingSlash(path: string): string {
  if (path === "/") return path;
  return path.replace(/\/+$/, "");
}

function pathDirname(path: string): string {
  const slash = path.lastIndexOf("/");
  const backslash = path.lastIndexOf("\\");
  const index = Math.max(slash, backslash);
  if (index < 0) return "";
  return path.slice(0, index);
}

function safeArtifactPathSegment(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "artifact"
  );
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
