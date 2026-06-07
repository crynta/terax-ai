import File01Icon from "@hugeicons/core-free-icons/File01Icon";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
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
  onRenameArtifact,
  onDeleteArtifact,
  onSaveArtifact,
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
            onRenameArtifact={onRenameArtifact}
            onDeleteArtifact={onDeleteArtifact}
            onSaveArtifact={onSaveArtifact}
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

function ArtifactDetail({
  artifact,
  selectedVersion,
  versions,
  versionsLoading,
  onSelectVersion,
  onExportArtifact,
  onRenameArtifact,
  onDeleteArtifact,
  onSaveArtifact,
}: ArtifactDetailProps) {
  const canPreview = isPreviewableArtifactKind(artifact.summary.kind);
  const defaultTab = canPreview ? "preview" : "code";
  const latestVersion = versions.reduce(
    (latest, version) => Math.max(latest, version.version),
    artifact.summary.version,
  );
  const viewingVersion = selectedVersion ?? artifact.summary.version;
  const canEdit = Boolean(onSaveArtifact) && viewingVersion === latestVersion;
  const [isEditing, setIsEditing] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draftContent, setDraftContent] = useState(artifact.content);
  const [draftTitle, setDraftTitle] = useState(artifact.summary.title);
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setIsEditing(false);
    setIsRenaming(false);
    setConfirmingDelete(false);
    setDraftContent(artifact.content);
    setDraftTitle(artifact.summary.title);
    setSaving(false);
    setRenaming(false);
    setDeleting(false);
  }, [
    artifact.content,
    artifact.summary.slug,
    artifact.summary.title,
    artifact.summary.version,
  ]);

  async function saveDraft() {
    if (
      !onSaveArtifact ||
      !canEdit ||
      saving ||
      draftContent === artifact.content
    ) {
      return;
    }
    setSaving(true);
    try {
      await onSaveArtifact(artifact, draftContent);
      setIsEditing(false);
    } catch {
      // The workspace save handler owns user-facing error reporting.
    } finally {
      setSaving(false);
    }
  }

  async function saveTitle() {
    const nextTitle = draftTitle.trim();
    if (
      !onRenameArtifact ||
      renaming ||
      nextTitle.length === 0 ||
      nextTitle === artifact.summary.title
    ) {
      return;
    }
    setRenaming(true);
    try {
      await onRenameArtifact(artifact, nextTitle);
      setIsRenaming(false);
    } catch {
      // The workspace rename handler owns user-facing error reporting.
    } finally {
      setRenaming(false);
    }
  }

  async function deleteArtifact() {
    if (!onDeleteArtifact || deleting) return;
    setDeleting(true);
    try {
      await onDeleteArtifact(artifact);
      setConfirmingDelete(false);
    } catch {
      // The workspace delete handler owns user-facing error reporting.
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <div className="min-w-0">
          {isRenaming ? (
            <div className="flex min-w-0 items-center gap-2">
              <input
                aria-label="Artifact title"
                className="h-8 min-w-0 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveTitle();
                  if (event.key === "Escape") {
                    setDraftTitle(artifact.summary.title);
                    setIsRenaming(false);
                  }
                }}
              />
              <Button
                size="sm"
                disabled={
                  renaming || draftTitle.trim() === artifact.summary.title
                }
                onClick={() => void saveTitle()}
              >
                {renaming ? "Saving…" : "Save title"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={renaming}
                onClick={() => {
                  setDraftTitle(artifact.summary.title);
                  setIsRenaming(false);
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <h3 className="truncate font-heading text-sm font-medium">
              {artifact.summary.title}
            </h3>
          )}
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <span>{artifact.summary.kind}</span>
            <span>v{artifact.summary.version}</span>
            <span>{formatBytes(artifact.summary.contentBytes)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onRenameArtifact ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={isRenaming}
              onClick={() => setIsRenaming(true)}
            >
              Rename
            </Button>
          ) : null}
          {onSaveArtifact ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={!canEdit || isEditing}
              title={canEdit ? undefined : "Select the latest version to edit"}
              onClick={() => setIsEditing(true)}
            >
              Edit
            </Button>
          ) : null}
          {onExportArtifact ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onExportArtifact(artifact)}
            >
              Export
            </Button>
          ) : null}
          {onDeleteArtifact ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={confirmingDelete}
              onClick={() => setConfirmingDelete(true)}
            >
              Delete
            </Button>
          ) : null}
        </div>
      </div>

      {confirmingDelete ? (
        <div className="flex items-center justify-between gap-3 border-b bg-destructive/5 px-3 py-2 text-sm">
          <div className="min-w-0">
            <div className="font-medium text-destructive">
              Delete this artifact?
            </div>
            <div className="text-muted-foreground text-xs">
              This removes every version from app storage. Export first if you
              need a copy.
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={deleting}
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={deleting}
              onClick={() => void deleteArtifact()}
            >
              {deleting ? "Deleting…" : "Delete permanently"}
            </Button>
          </div>
        </div>
      ) : null}

      <ArtifactVersionControls
        currentVersion={artifact.summary.version}
        selectedVersion={selectedVersion}
        versions={versions}
        versionsLoading={versionsLoading}
        onSelectVersion={onSelectVersion}
      />

      {isEditing ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b bg-muted/20 px-3 py-2">
            <div className="min-w-0">
              <div className="text-xs font-medium">Editing latest version</div>
              <div className="text-muted-foreground text-[11px]">
                Save creates a new artifact version.
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setDraftContent(artifact.content);
                  setIsEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={saving || draftContent === artifact.content}
                onClick={() => void saveDraft()}
              >
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
          <textarea
            aria-label="Artifact source"
            className="min-h-[360px] flex-1 resize-none border-0 bg-background p-4 font-mono text-xs leading-relaxed outline-none ring-0 focus-visible:ring-2 focus-visible:ring-ring"
            spellCheck={false}
            value={draftContent}
            onChange={(event) => setDraftContent(event.currentTarget.value)}
          />
        </div>
      ) : (
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
      )}
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
