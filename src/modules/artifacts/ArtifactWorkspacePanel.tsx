import { save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ArtifactPanel } from "@/modules/artifacts/components/ArtifactPanel";
import { useArtifactCollection } from "@/modules/artifacts/hooks/useArtifactCollection";
import {
  artifactExportFilename,
  artifactExportFilters,
} from "@/modules/artifacts/lib/export";
import { artifactsNative } from "@/modules/artifacts/lib/native";
import type {
  Artifact,
  ArtifactSummary,
  ArtifactVersionSummary,
} from "@/modules/artifacts/lib/types";

type ArtifactWorkspacePanelProps = {
  className?: string;
  conversationId: string;
  selectedSlug: string | null;
  onSelectedSlugChange?: (slug: string | null) => void;
};

type ArtifactWorkspacePanelViewProps = {
  artifacts: ArtifactSummary[];
  selectedArtifact: Artifact | null;
  className?: string;
  selectedArtifactError?: string | null;
  selectedVersion?: number | null;
  versions?: ArtifactVersionSummary[];
  versionsError?: string | null;
  versionsLoading?: boolean;
  onSelectArtifact?: (slug: string) => void;
  onSelectVersion?: (version: number) => void;
  onExportArtifact?: (artifact: Artifact) => void;
  onRenameArtifact?: (
    artifact: Artifact,
    title: string,
  ) => Promise<void> | void;
  onDeleteArtifact?: (artifact: Artifact) => Promise<void> | void;
  onSaveArtifact?: (
    artifact: Artifact,
    content: string,
  ) => Promise<void> | void;
};

export function ArtifactWorkspacePanel({
  className,
  conversationId,
  selectedSlug,
  onSelectedSlugChange,
}: ArtifactWorkspacePanelProps) {
  const { artifacts, refresh } = useArtifactCollection(conversationId);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(
    null,
  );
  const [versions, setVersions] = useState<ArtifactVersionSummary[]>([]);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [selectedArtifactError, setSelectedArtifactError] = useState<
    string | null
  >(null);
  const [versionRefreshKey, setVersionRefreshKey] = useState(0);
  const effectiveSlug = selectedSlug ?? artifacts[0]?.slug ?? null;
  const selectedSummaryVersion =
    artifacts.find((artifact) => artifact.slug === effectiveSlug)?.version ??
    null;
  const latestArtifactsRef = useRef(artifacts);
  const latestSelectionHandlerRef = useRef(onSelectedSlugChange);
  const mountedRef = useRef(true);

  useEffect(() => {
    latestArtifactsRef.current = artifacts;
  }, [artifacts]);

  useEffect(() => {
    latestSelectionHandlerRef.current = onSelectedSlugChange;
  }, [onSelectedSlugChange]);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    if (!selectedSlug && effectiveSlug) onSelectedSlugChange?.(effectiveSlug);
  }, [effectiveSlug, onSelectedSlugChange, selectedSlug]);

  useEffect(() => {
    setSelectedVersion(null);
  }, [conversationId, effectiveSlug]);

  useEffect(() => {
    if (!effectiveSlug) {
      setVersions([]);
      setVersionsError(null);
      setVersionsLoading(false);
      return;
    }
    let cancelled = false;
    setVersionsLoading(true);
    artifactsNative
      .versions(conversationId, effectiveSlug)
      .then((nextVersions) => {
        if (!cancelled) {
          setVersions(nextVersions);
          setVersionsError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setVersions([]);
          setVersionsError(
            `Artifact versions failed to load: ${artifactErrorMessage(error)}`,
          );
        }
      })
      .finally(() => {
        if (!cancelled) setVersionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    conversationId,
    effectiveSlug,
    selectedSummaryVersion,
    versionRefreshKey,
  ]);

  useEffect(() => {
    if (!effectiveSlug) {
      setSelectedArtifact(null);
      setSelectedArtifactError(null);
      return;
    }
    let cancelled = false;
    artifactsNative
      .get(conversationId, effectiveSlug, selectedVersion)
      .then((artifact) => {
        if (!cancelled) {
          setSelectedArtifact(artifact);
          setSelectedArtifactError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSelectedArtifact(null);
          setSelectedArtifactError(
            `Artifact failed to load: ${artifactErrorMessage(error)}`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, effectiveSlug, selectedSummaryVersion, selectedVersion]);

  const selectArtifact = useCallback(
    (slug: string) => {
      setSelectedVersion(null);
      onSelectedSlugChange?.(slug);
    },
    [onSelectedSlugChange],
  );

  const renameArtifact = useCallback(
    async (artifact: Artifact, title: string) => {
      try {
        const renamed = await artifactsNative.renameTitle(
          artifact.summary.conversationId,
          artifact.summary.slug,
          title,
        );
        setSelectedVersion(null);
        setSelectedArtifact(renamed);
        setVersionRefreshKey((key) => key + 1);
        await refresh();
        toast.success("Artifact renamed", {
          description: renamed.summary.title,
        });
      } catch (error) {
        toast.error("Artifact rename failed", {
          description: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    [refresh],
  );

  const deleteArtifact = useCallback(
    async (artifact: Artifact) => {
      try {
        const deletedSlug = artifact.summary.slug;
        const deleteResult = await artifactsNative.delete(
          artifact.summary.conversationId,
          deletedSlug,
        );
        const nextSlug =
          latestArtifactsRef.current.find((item) => item.slug !== deletedSlug)
            ?.slug ?? null;
        if (mountedRef.current) {
          setSelectedVersion(null);
          setSelectedArtifact(null);
          setVersions([]);
          latestSelectionHandlerRef.current?.(nextSlug);
          await refresh();
        }
        toast.success("Artifact moved to trash", {
          description: artifact.summary.title,
          action: deleteResult.undoToken
            ? {
                label: "Undo",
                onClick: async () => {
                  try {
                    const restored = await artifactsNative.restoreDeleted(
                      artifact.summary.conversationId,
                      deletedSlug,
                      deleteResult.undoToken,
                    );
                    if (mountedRef.current) {
                      setSelectedVersion(null);
                      setSelectedArtifact(restored);
                      latestSelectionHandlerRef.current?.(
                        restored.summary.slug,
                      );
                      setVersionRefreshKey((key) => key + 1);
                      await refresh();
                    }
                    toast.success("Artifact restored", {
                      description: restored.summary.title,
                    });
                  } catch (restoreError) {
                    toast.error("Artifact restore failed", {
                      description:
                        restoreError instanceof Error
                          ? restoreError.message
                          : String(restoreError),
                    });
                  }
                },
              }
            : undefined,
        });
      } catch (error) {
        toast.error("Artifact delete failed", {
          description: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    [refresh],
  );

  const saveArtifact = useCallback(
    async (artifact: Artifact, content: string) => {
      try {
        const updated = await artifactsNative.update(
          artifact.summary.conversationId,
          artifact.summary.slug,
          content,
          artifact.summary.version,
        );
        setSelectedVersion(null);
        setSelectedArtifact(updated);
        setVersionRefreshKey((key) => key + 1);
        await refresh();
        toast.success(`Saved ${artifact.summary.title}`, {
          description: `Created version ${updated.summary.version}`,
        });
      } catch (error) {
        toast.error("Artifact save failed", {
          description: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    [refresh],
  );

  const exportArtifact = useCallback(async (artifact: Artifact) => {
    try {
      const destinationPath = await save({
        title: "Export artifact",
        defaultPath: artifactExportFilename(artifact),
        filters: artifactExportFilters(artifact.summary.kind),
      });
      if (!destinationPath) return;
      const result = await artifactsNative.export(
        artifact.summary.conversationId,
        artifact.summary.slug,
        destinationPath,
        artifact.summary.version,
      );
      toast.success(`Exported ${artifact.summary.title}`, {
        description: result.path,
      });
    } catch (error) {
      toast.error("Artifact export failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  return (
    <ArtifactWorkspacePanelView
      artifacts={artifacts}
      className={className}
      selectedArtifact={selectedArtifact}
      selectedArtifactError={selectedArtifactError}
      selectedVersion={selectedVersion}
      versions={versions}
      versionsError={versionsError}
      versionsLoading={versionsLoading}
      onExportArtifact={exportArtifact}
      onRenameArtifact={renameArtifact}
      onDeleteArtifact={deleteArtifact}
      onSaveArtifact={saveArtifact}
      onSelectArtifact={selectArtifact}
      onSelectVersion={setSelectedVersion}
    />
  );
}

export function ArtifactWorkspacePanelView({
  artifacts,
  selectedArtifact,
  className,
  selectedArtifactError = null,
  selectedVersion = null,
  versions = [],
  versionsError = null,
  versionsLoading = false,
  onSelectArtifact,
  onSelectVersion,
  onExportArtifact,
  onRenameArtifact,
  onDeleteArtifact,
  onSaveArtifact,
}: ArtifactWorkspacePanelViewProps) {
  return (
    <div
      className={cn(
        "h-full min-h-0 rounded-md border bg-background",
        className,
      )}
    >
      <div className="flex h-full min-h-0 flex-col">
        {versionsError || selectedArtifactError ? (
          <div className="flex shrink-0 flex-col gap-1 border-b border-destructive/25 bg-destructive/5 px-3 py-2 text-destructive text-xs">
            {versionsError ? <div>{versionsError}</div> : null}
            {selectedArtifactError ? <div>{selectedArtifactError}</div> : null}
          </div>
        ) : null}
        <ArtifactPanel
          artifacts={artifacts}
          className="min-h-0 flex-1"
          selectedArtifact={selectedArtifact}
          selectedVersion={selectedVersion}
          versions={versions}
          versionsLoading={versionsLoading}
          onExportArtifact={onExportArtifact}
          onRenameArtifact={onRenameArtifact}
          onDeleteArtifact={onDeleteArtifact}
          onSaveArtifact={onSaveArtifact}
          onSelectArtifact={onSelectArtifact}
          onSelectVersion={onSelectVersion}
        />
      </div>
    </div>
  );
}

function artifactErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
