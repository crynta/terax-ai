import { save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ArtifactPanel } from "@/modules/artifacts/components/ArtifactPanel";
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
import { useArtifactCollection } from "@/modules/artifacts/hooks/useArtifactCollection";

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
  selectedVersion?: number | null;
  versions?: ArtifactVersionSummary[];
  versionsLoading?: boolean;
  onSelectArtifact?: (slug: string) => void;
  onSelectVersion?: (version: number) => void;
  onExportArtifact?: (artifact: Artifact) => void;
};

export function ArtifactWorkspacePanel({
  className,
  conversationId,
  selectedSlug,
  onSelectedSlugChange,
}: ArtifactWorkspacePanelProps) {
  const { artifacts } = useArtifactCollection(conversationId);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(
    null,
  );
  const [versions, setVersions] = useState<ArtifactVersionSummary[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const effectiveSlug = selectedSlug ?? artifacts[0]?.slug ?? null;

  useEffect(() => {
    if (!selectedSlug && effectiveSlug) onSelectedSlugChange?.(effectiveSlug);
  }, [effectiveSlug, onSelectedSlugChange, selectedSlug]);

  useEffect(() => {
    setSelectedVersion(null);
  }, [conversationId, effectiveSlug]);

  useEffect(() => {
    if (!effectiveSlug) {
      setVersions([]);
      setVersionsLoading(false);
      return;
    }
    let cancelled = false;
    setVersionsLoading(true);
    artifactsNative
      .versions(conversationId, effectiveSlug)
      .then((nextVersions) => {
        if (!cancelled) setVersions(nextVersions);
      })
      .catch(() => {
        if (!cancelled) setVersions([]);
      })
      .finally(() => {
        if (!cancelled) setVersionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, effectiveSlug]);

  useEffect(() => {
    if (!effectiveSlug) {
      setSelectedArtifact(null);
      return;
    }
    let cancelled = false;
    artifactsNative
      .get(conversationId, effectiveSlug, selectedVersion)
      .then((artifact) => {
        if (!cancelled) setSelectedArtifact(artifact);
      })
      .catch(() => {
        if (!cancelled) setSelectedArtifact(null);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, effectiveSlug, selectedVersion]);

  const selectArtifact = useCallback(
    (slug: string) => {
      setSelectedVersion(null);
      onSelectedSlugChange?.(slug);
    },
    [onSelectedSlugChange],
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
      selectedVersion={selectedVersion}
      versions={versions}
      versionsLoading={versionsLoading}
      onExportArtifact={exportArtifact}
      onSelectArtifact={selectArtifact}
      onSelectVersion={setSelectedVersion}
    />
  );
}

export function ArtifactWorkspacePanelView({
  artifacts,
  selectedArtifact,
  className,
  selectedVersion = null,
  versions = [],
  versionsLoading = false,
  onSelectArtifact,
  onSelectVersion,
  onExportArtifact,
}: ArtifactWorkspacePanelViewProps) {
  return (
    <div
      className={cn(
        "h-full min-h-0 rounded-md border bg-background",
        className,
      )}
    >
      <ArtifactPanel
        artifacts={artifacts}
        selectedArtifact={selectedArtifact}
        selectedVersion={selectedVersion}
        versions={versions}
        versionsLoading={versionsLoading}
        onExportArtifact={onExportArtifact}
        onSelectArtifact={onSelectArtifact}
        onSelectVersion={onSelectVersion}
      />
    </div>
  );
}
