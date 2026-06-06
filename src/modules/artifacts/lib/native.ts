import { invoke } from "@tauri-apps/api/core";
import type {
  Artifact,
  ArtifactCreateInput,
  ArtifactDeleteResult,
  ArtifactExportResult,
  ArtifactSummary,
  ArtifactTextEdit,
  ArtifactVersionSummary,
  ReactCompileResult,
} from "@/modules/artifacts/lib/types";

export const artifactsNative = {
  list: (conversationId: string) =>
    invoke<ArtifactSummary[]>("artifacts_list", { conversationId }),
  get: (conversationId: string, slug: string, version?: number | null) =>
    invoke<Artifact>("artifacts_get", {
      conversationId,
      slug,
      version: version ?? null,
    }),
  compileReact: (content: string) =>
    invoke<ReactCompileResult>("artifacts_compile_react", {
      input: { content },
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
  deleteForConversation: (conversationId: string) =>
    invoke<ArtifactDeleteResult>("artifacts_delete_for_conversation", {
      conversationId,
    }),
};
