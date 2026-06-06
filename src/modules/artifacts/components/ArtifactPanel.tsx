import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { ArtifactPreviewFrame } from "@/modules/artifacts/components/ArtifactPreviewFrame";
import { isPreviewableArtifactKind } from "@/modules/artifacts/lib/preview";
import type {
  Artifact,
  ArtifactSummary,
  ArtifactVersionSummary,
} from "@/modules/artifacts/lib/types";

type ArtifactPanelProps = {
  artifacts: ArtifactSummary[];
  selectedArtifact: Artifact | null;
  className?: string;
  selectedVersion?: number | null;
  versions?: ArtifactVersionSummary[];
  versionsLoading?: boolean;
  onSelectArtifact?: (slug: string) => void;
  onClose?: () => void;
  onSelectVersion?: (version: number) => void;
  onExportArtifact?: (artifact: Artifact) => void;
};

export function ArtifactPanel({
  artifacts,
  selectedArtifact,
  className,
  selectedVersion = null,
  versions = [],
  versionsLoading = false,
  onSelectArtifact,
  onClose,
  onSelectVersion,
  onExportArtifact,
}: ArtifactPanelProps) {
  if (artifacts.length === 0) {
    return (
      <section
        aria-label="Artifacts"
        className={cn("flex h-full min-h-0 flex-col bg-background", className)}
      >
        <Empty className="m-3 min-h-72 flex-1 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={File01Icon} />
            </EmptyMedia>
            <EmptyTitle>No artifacts yet</EmptyTitle>
            <EmptyDescription>
              Ask Pi to create an artifact when you need a reusable preview,
              document, or code draft.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <span className="text-muted-foreground text-xs">
              HTML, Markdown, text, JSON, and SVG artifacts stay in app storage
              until exported.
            </span>
          </EmptyContent>
        </Empty>
      </section>
    );
  }

  return (
    <section
      aria-label="Artifacts"
      className={cn("flex h-full min-h-0 flex-col bg-background", className)}
    >
      <header className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate font-heading text-sm font-medium">
            Artifacts
          </h2>
          <p className="text-muted-foreground text-xs">
            {artifacts.length} saved in this conversation
          </p>
        </div>
        {onClose ? (
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)]">
        <ScrollArea className="min-h-0 border-r">
          <div className="flex flex-col gap-1 p-2">
            {artifacts.map((artifact) => (
              <ArtifactListItem
                artifact={artifact}
                key={artifact.slug}
                selected={artifact.slug === selectedArtifact?.summary.slug}
                onSelect={onSelectArtifact}
              />
            ))}
          </div>
        </ScrollArea>

        {selectedArtifact ? (
          <ArtifactDetail
            artifact={selectedArtifact}
            selectedVersion={
              selectedVersion ?? selectedArtifact.summary.version
            }
            versions={versions}
            versionsLoading={versionsLoading}
            onSelectVersion={onSelectVersion}
            onExportArtifact={onExportArtifact}
          />
        ) : (
          <Empty className="m-3 border">
            <EmptyHeader>
              <EmptyTitle>Select an artifact</EmptyTitle>
              <EmptyDescription>
                Choose an artifact to preview its latest version or inspect the
                stored source.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </section>
  );
}

type ArtifactListItemProps = {
  artifact: ArtifactSummary;
  selected: boolean;
  onSelect?: (slug: string) => void;
};

function ArtifactListItem({
  artifact,
  selected,
  onSelect,
}: ArtifactListItemProps) {
  return (
    <button
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
        selected && "bg-muted text-foreground",
      )}
      onClick={() => onSelect?.(artifact.slug)}
      type="button"
    >
      <span className="truncate font-medium">{artifact.title}</span>
      <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <Badge variant="outline">{artifact.kind}</Badge>
        <span>v{artifact.version}</span>
        <span>{formatBytes(artifact.contentBytes)}</span>
      </span>
    </button>
  );
}

type ArtifactDetailProps = {
  artifact: Artifact;
  selectedVersion: number;
  versions: ArtifactVersionSummary[];
  versionsLoading: boolean;
  onSelectVersion?: (version: number) => void;
  onExportArtifact?: (artifact: Artifact) => void;
};

function ArtifactDetail({
  artifact,
  selectedVersion,
  versions,
  versionsLoading,
  onSelectVersion,
  onExportArtifact,
}: ArtifactDetailProps) {
  const canPreview = isPreviewableArtifactKind(artifact.summary.kind);
  const defaultTab = canPreview ? "preview" : "code";

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <div className="min-w-0">
          <h3 className="truncate font-heading text-sm font-medium">
            {artifact.summary.title}
          </h3>
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <span>{artifact.summary.kind}</span>
            <span>v{artifact.summary.version}</span>
            <span>{formatBytes(artifact.summary.contentBytes)}</span>
          </div>
        </div>
        {onExportArtifact ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onExportArtifact(artifact)}
          >
            Export
          </Button>
        ) : null}
      </div>

      <ArtifactVersionControls
        currentVersion={artifact.summary.version}
        selectedVersion={selectedVersion}
        versions={versions}
        versionsLoading={versionsLoading}
        onSelectVersion={onSelectVersion}
      />

      <Tabs defaultValue={defaultTab} className="min-h-0 flex-1 gap-0">
        <div className="border-b px-3 py-2">
          <TabsList>
            <TabsTrigger disabled={!canPreview} value="preview">
              Preview
            </TabsTrigger>
            <TabsTrigger value="code">Code</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent className="min-h-0" value="preview">
          {canPreview ? (
            <ArtifactPreviewFrame
              artifact={artifact}
              className="h-full min-h-[360px] w-full border-0 bg-background"
            />
          ) : null}
        </TabsContent>
        <TabsContent className="min-h-0" value="code">
          <ScrollArea className="h-full min-h-[360px]">
            <pre className="m-0 whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed">
              {artifact.content}
            </pre>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

type ArtifactVersionControlsProps = {
  currentVersion: number;
  selectedVersion: number;
  versions: ArtifactVersionSummary[];
  versionsLoading: boolean;
  onSelectVersion?: (version: number) => void;
};

function ArtifactVersionControls({
  currentVersion,
  selectedVersion,
  versions,
  versionsLoading,
  onSelectVersion,
}: ArtifactVersionControlsProps) {
  const displayVersions = versions.length > 0 ? versions : [];
  if (displayVersions.length === 0 && !versionsLoading) {
    return null;
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b bg-muted/20 px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs font-medium">Versions</div>
        <div className="text-muted-foreground text-[11px]">
          Viewing v{selectedVersion}
          {selectedVersion === currentVersion ? " (latest)" : ""}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto">
        {versionsLoading ? (
          <Badge variant="outline" className="h-6 rounded-md text-[10px]">
            Loading versions
          </Badge>
        ) : null}
        {displayVersions.map((version) => {
          const selected = version.version === selectedVersion;
          return (
            <Button
              key={version.version}
              type="button"
              size="sm"
              variant={selected ? "secondary" : "ghost"}
              aria-pressed={selected}
              disabled={selected || !onSelectVersion}
              onClick={() => onSelectVersion?.(version.version)}
              className="h-7 px-2 text-[11px]"
            >
              v{version.version}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
