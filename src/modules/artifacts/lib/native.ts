import { invoke } from "@tauri-apps/api/core";
import type {
  Artifact,
  ArtifactBulkResult,
  ArtifactBulkTarget,
  ArtifactConversationArtifacts,
  ArtifactCreateInput,
  ArtifactDeleteResult,
  ArtifactExportResult,
  ArtifactSummary,
  ArtifactTextEdit,
  ArtifactVersionSummary,
  DeletedArtifactSummary,
  ReactCompileResult,
} from "@/modules/artifacts/lib/types";

export const artifactsNative = {
  list: (conversationId: string) =>
    invoke<ArtifactSummary[]>("artifacts_list", { conversationId }),
  listAll: () => invoke<ArtifactConversationArtifacts[]>("artifacts_list_all"),
  listDeleted: () => invoke<DeletedArtifactSummary[]>("artifacts_list_deleted"),
  get: (conversationId: string, slug: string, version?: number | null) =>
    invoke<Artifact>("artifacts_get", {
      conversationId,
      slug,
      version: version ?? null,
    }),
  compileReact: (content: string, previewToken?: string | null) =>
    invoke<ReactCompileResult>("artifacts_compile_react", {
      input: { content, previewToken: previewToken ?? null },
    }),
  create: (conversationId: string, input: ArtifactCreateInput) =>
    invoke<Artifact>("artifacts_create", { conversationId, input }),
  update: (
    conversationId: string,
    slug: string,
    content: string,
    baseVersion?: number | null,
  ) =>
    invoke<Artifact>("artifacts_update", {
      conversationId,
      slug,
      content,
      baseVersion: baseVersion ?? null,
    }),
  renameTitle: (conversationId: string, slug: string, title: string) =>
    invoke<Artifact>("artifacts_rename_title", {
      conversationId,
      slug,
      title,
    }),
  edit: (
    conversationId: string,
    slug: string,
    edits: ArtifactTextEdit[],
    baseVersion?: number | null,
  ) =>
    invoke<Artifact>("artifacts_edit", {
      conversationId,
      slug,
      edits,
      baseVersion: baseVersion ?? null,
    }),
  versions: (conversationId: string, slug: string) =>
    invoke<ArtifactVersionSummary[]>("artifacts_versions", {
      conversationId,
      slug,
    }),
  export: (
    conversationId: string,
    slug: string,
    destinationPath: string,
    version?: number | null,
  ) =>
    invoke<ArtifactExportResult>("artifacts_export", {
      conversationId,
      slug,
      destinationPath,
      version: version ?? null,
    }),
  delete: (conversationId: string, slug: string) =>
    invoke<ArtifactDeleteResult>("artifacts_delete", { conversationId, slug }),
  deleteMany: (targets: ArtifactBulkTarget[]) =>
    invoke<ArtifactBulkResult>("artifacts_delete_many", { targets }),
  restoreDeleted: (
    conversationId: string,
    slug: string,
    undoToken?: string | null,
  ) =>
    invoke<Artifact>("artifacts_restore_deleted", {
      conversationId,
      slug,
      undoToken: undoToken ?? null,
    }),
  purgeDeleted: (conversationId: string, slug: string, undoToken: string) =>
    invoke<ArtifactDeleteResult>("artifacts_purge_deleted", {
      conversationId,
      slug,
      undoToken,
    }),
  restoreDeletedMany: (targets: ArtifactBulkTarget[]) =>
    invoke<ArtifactBulkResult>("artifacts_restore_deleted_many", { targets }),
  exportMany: (targets: ArtifactBulkTarget[], destinationDir: string) =>
    invoke<ArtifactBulkResult>("artifacts_export_many", {
      targets,
      destinationDir,
    }),
  deleteForConversation: (conversationId: string) =>
    invoke<ArtifactDeleteResult>("artifacts_delete_for_conversation", {
      conversationId,
    }),
};
