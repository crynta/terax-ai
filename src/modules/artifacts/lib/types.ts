export type ArtifactKind =
  | "html"
  | "react"
  | "markdown"
  | "text"
  | "json"
  | "svg";

export type ArtifactSummary = {
  conversationId: string;
  slug: string;
  title: string;
  kind: ArtifactKind;
  version: number;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  contentBytes: number;
};

export type ArtifactConversationArtifacts = {
  conversationId: string;
  artifactCount: number;
  updatedAt: string | null;
  artifacts: ArtifactSummary[];
};

export type DeletedArtifactSummary = {
  conversationId: string;
  slug: string;
  title: string;
  kind: ArtifactKind;
  version: number;
  contentHash: string;
  deletedAt: string;
  contentBytes: number;
  undoToken: string;
};

export type Artifact = {
  summary: ArtifactSummary;
  content: string;
};

export type ArtifactVersionSummary = {
  version: number;
  contentHash: string;
  contentBytes: number;
  createdAt: string;
};

export type ArtifactCreateInput = {
  slug: string;
  kind: ArtifactKind;
  content: string;
  title?: string | null;
};

export type ArtifactDiagnosticSeverity = "error" | "warning" | "info";

export type ArtifactDiagnostic = {
  code: string;
  severity: ArtifactDiagnosticSeverity;
  message: string;
  line?: number | null;
  column?: number | null;
  endLine?: number | null;
  endColumn?: number | null;
  excerpt?: string | null;
};

export type ReactCompileInput = {
  content: string;
  previewToken?: string | null;
};

export type ReactCompileResult = {
  document: string;
  diagnostics: ArtifactDiagnostic[];
};

export type ArtifactTextEdit = {
  oldText: string;
  newText: string;
};

export type ArtifactDeleteResult = {
  deleted: boolean;
  deletedCount: number;
  undoToken?: string | null;
};

export type ArtifactBulkTarget = {
  conversationId: string;
  slug: string;
  undoToken?: string | null;
  version?: number | null;
};

export type ArtifactBulkItemResult = {
  conversationId: string;
  slug: string;
  success: boolean;
  undoToken?: string | null;
  path?: string | null;
  contentHash?: string | null;
  contentBytes?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type ArtifactBulkResult = {
  requestedCount: number;
  successCount: number;
  failureCount: number;
  items: ArtifactBulkItemResult[];
};

export type ArtifactExportResult = {
  conversationId: string;
  slug: string;
  version: number;
  path: string;
  contentHash: string;
  contentBytes: number;
};

export type ArtifactUpdateReason =
  | "create"
  | "update"
  | "edit"
  | "save"
  | "rename"
  | "restore";

export type ArtifactUpdateEvent = {
  type: "artifact:update";
  conversationId: string;
  artifact: ArtifactSummary;
  reason: ArtifactUpdateReason;
};

export type ArtifactDeleteEvent = {
  type: "artifact:delete";
  conversationId: string;
  slug: string;
  undoToken?: string | null;
};

export type ArtifactConversationDeleteEvent = {
  type: "artifact:conversation-delete";
  conversationId: string;
  deletedCount: number;
};
