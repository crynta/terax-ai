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

export type ReactCompileInput = {
  content: string;
};

export type ReactCompileResult = {
  document: string;
  diagnostics: string[];
};

export type ArtifactTextEdit = {
  oldText: string;
  newText: string;
};

export type ArtifactDeleteResult = {
  deleted: boolean;
  deletedCount: number;
};

export type ArtifactExportResult = {
  conversationId: string;
  slug: string;
  version: number;
  path: string;
  contentHash: string;
  contentBytes: number;
};

export type ArtifactUpdateReason = "create" | "update" | "edit" | "save";

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
};

export type ArtifactConversationDeleteEvent = {
  type: "artifact:conversation-delete";
  conversationId: string;
  deletedCount: number;
};
