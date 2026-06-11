import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ArtifactPreviewFrame } from "@/modules/artifacts/components/ArtifactPreviewFrame";
import {
  artifactHubErrorMessage,
  type ArtifactHubTarget,
  useArtifactHubData,
} from "@/modules/artifacts/hooks/useArtifactHubData";
import {
  type ArtifactHubRow,
  type ArtifactHubSession,
  artifactHubRows,
  filterArtifactHubRows,
} from "@/modules/artifacts/lib/hub";
import { artifactsNative } from "@/modules/artifacts/lib/native";
import type {
  Artifact,
  ArtifactBulkTarget,
  ArtifactKind,
  DeletedArtifactSummary,
} from "@/modules/artifacts/lib/types";

const ARTIFACT_KINDS: readonly (ArtifactKind | "all")[] = [
  "all",
  "html",
  "react",
  "markdown",
  "text",
  "json",
  "svg",
];

type ArtifactHubPanelProps = {
  className?: string;
  onOpenArtifact: (conversationId: string, slug: string) => void;
};

type ArtifactHubMode = "active" | "trash";

type ArtifactHubPanelViewProps = ArtifactHubPanelProps & {
  bulkBusy?: boolean;
  deletedArtifacts?: DeletedArtifactSummary[];
  deletedError?: string | null;
  deletedLoading?: boolean;
  error?: string | null;
  initialMode?: ArtifactHubMode;
  loading?: boolean;
  previewArtifact?: Artifact | null;
  previewError?: string | null;
  previewLoading?: boolean;
  previewTarget?: ArtifactHubTarget | null;
  sessions: ArtifactHubSession[];
  onCopyMetadata?: (summary: string) => void;
  onDeleteArtifacts?: (targets: ArtifactBulkTarget[]) => void;
  onExportArtifacts?: (targets: ArtifactBulkTarget[]) => void;
  onPreviewArtifact?: (conversationId: string, slug: string) => void;
  onPurgeDeletedArtifact?: (artifact: DeletedArtifactSummary) => void;
  onRestoreDeletedArtifact?: (artifact: DeletedArtifactSummary) => void;
  onRestoreDeletedArtifacts?: (targets: ArtifactBulkTarget[]) => void;
};

export function ArtifactHubPanel({
  className,
  onOpenArtifact,
}: ArtifactHubPanelProps) {
  const {
    deletedArtifacts,
    deletedError,
    deletedLoading,
    error,
    loading,
    previewArtifact,
    previewError,
    previewLoading,
    previewTarget,
    reload,
    sessions,
    setPreviewTarget,
  } = useArtifactHubData();
  const [bulkBusy, setBulkBusy] = useState(false);
  const bulkBusyRef = useRef(false);
  const beginBulkAction = () => {
    if (bulkBusyRef.current) return false;
    bulkBusyRef.current = true;
    setBulkBusy(true);
    return true;
  };
  const endBulkAction = () => {
    bulkBusyRef.current = false;
    setBulkBusy(false);
  };
  const runBulkDelete = async (targets: ArtifactBulkTarget[]) => {
    if (targets.length === 0 || !beginBulkAction()) return;
    try {
      const result = await artifactsNative.deleteMany(targets);
      toast.success("Moved artifacts to trash", {
        description: `${result.successCount} moved, ${result.failureCount} failed`,
      });
      reload();
    } catch (nextError) {
      toast.error("Bulk delete failed", {
        description:
          nextError instanceof Error ? nextError.message : String(nextError),
      });
    } finally {
      endBulkAction();
    }
  };
  const runBulkRestore = async (targets: ArtifactBulkTarget[]) => {
    if (targets.length === 0 || !beginBulkAction()) return;
    try {
      const result = await artifactsNative.restoreDeletedMany(targets);
      toast.success("Restored artifacts", {
        description: `${result.successCount} restored, ${result.failureCount} failed`,
      });
      reload();
    } catch (nextError) {
      toast.error("Bulk restore failed", {
        description:
          nextError instanceof Error ? nextError.message : String(nextError),
      });
    } finally {
      endBulkAction();
    }
  };
  const runBulkExport = async (targets: ArtifactBulkTarget[]) => {
    if (targets.length === 0 || !beginBulkAction()) return;
    try {
      const selectedDirectory = await open({
        title: "Export artifacts",
        directory: true,
        multiple: false,
      });
      const destinationDir = Array.isArray(selectedDirectory)
        ? selectedDirectory[0]
        : selectedDirectory;
      if (!destinationDir) return;
      const result = await artifactsNative.exportMany(targets, destinationDir);
      toast.success("Exported artifacts", {
        description: `${result.successCount} exported, ${result.failureCount} failed`,
      });
    } catch (nextError) {
      toast.error("Bulk export failed", {
        description:
          nextError instanceof Error ? nextError.message : String(nextError),
      });
    } finally {
      endBulkAction();
    }
  };
  const runPurgeDeletedArtifact = async (artifact: DeletedArtifactSummary) => {
    try {
      await artifactsNative.purgeDeleted(
        artifact.conversationId,
        artifact.slug,
        artifact.undoToken,
      );
      toast.success("Artifact deleted forever", {
        description: artifact.title,
      });
      reload();
    } catch (nextError) {
      toast.error("Artifact purge failed", {
        description: artifactHubErrorMessage(nextError),
      });
    }
  };
  const runRestoreDeletedArtifact = async (
    artifact: DeletedArtifactSummary,
  ) => {
    try {
      const restored = await artifactsNative.restoreDeleted(
        artifact.conversationId,
        artifact.slug,
        artifact.undoToken,
      );
      toast.success("Artifact restored", {
        description: restored.summary.title,
      });
      reload();
    } catch (nextError) {
      toast.error("Artifact restore failed", {
        description: artifactHubErrorMessage(nextError),
      });
    }
  };

  return (
    <ArtifactHubPanelView
      bulkBusy={bulkBusy}
      className={className}
      deletedArtifacts={deletedArtifacts}
      deletedError={deletedError}
      deletedLoading={deletedLoading}
      error={error}
      loading={loading}
      previewArtifact={previewArtifact}
      previewError={previewError}
      previewLoading={previewLoading}
      previewTarget={previewTarget}
      sessions={sessions}
      onCopyMetadata={copyMetadataToClipboard}
      onDeleteArtifacts={(targets) => {
        void runBulkDelete(targets);
      }}
      onExportArtifacts={(targets) => {
        void runBulkExport(targets);
      }}
      onOpenArtifact={onOpenArtifact}
      onPreviewArtifact={(conversationId, slug) =>
        setPreviewTarget({ conversationId, slug })
      }
      onPurgeDeletedArtifact={(artifact) => {
        void runPurgeDeletedArtifact(artifact);
      }}
      onRestoreDeletedArtifact={(artifact) => {
        void runRestoreDeletedArtifact(artifact);
      }}
      onRestoreDeletedArtifacts={(targets) => {
        void runBulkRestore(targets);
      }}
    />
  );
}

export function ArtifactHubPanelView({
  bulkBusy = false,
  className,
  deletedArtifacts = [],
  deletedError = null,
  deletedLoading = false,
  error = null,
  initialMode = "active",
  loading = false,
  previewArtifact = null,
  previewError = null,
  previewLoading = false,
  previewTarget = null,
  sessions,
  onCopyMetadata,
  onDeleteArtifacts,
  onExportArtifacts,
  onOpenArtifact,
  onPreviewArtifact,
  onPurgeDeletedArtifact,
  onRestoreDeletedArtifact,
  onRestoreDeletedArtifacts,
}: ArtifactHubPanelViewProps) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ArtifactKind | "all">("all");
  const [selectedSessionId, setSelectedSessionId] = useState<string | "all">(
    "all",
  );
  const [mode, setMode] = useState<ArtifactHubMode>(initialMode);
  const rows = useMemo(() => artifactHubRows(sessions), [sessions]);
  const scopedRows = useMemo(
    () =>
      selectedSessionId === "all"
        ? rows
        : rows.filter((row) => row.sessionId === selectedSessionId),
    [rows, selectedSessionId],
  );
  const filteredRows = useMemo(
    () => filterArtifactHubRows(scopedRows, query, kind),
    [kind, query, scopedRows],
  );
  const artifactCount = rows.length;
  const deletedCount = deletedArtifacts.length;
  const filteredDeletedArtifacts = useMemo(
    () => filterDeletedArtifacts(deletedArtifacts, query, kind),
    [deletedArtifacts, kind, query],
  );
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [selectedDeletedKeys, setSelectedDeletedKeys] = useState<Set<string>>(
    new Set(),
  );
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedKeys.has(artifactHubRowKey(row))),
    [rows, selectedKeys],
  );
  const selectedDeletedArtifacts = useMemo(
    () =>
      deletedArtifacts.filter((artifact) =>
        selectedDeletedKeys.has(deletedArtifactKey(artifact)),
      ),
    [deletedArtifacts, selectedDeletedKeys],
  );
  const activeSelectedCount = selectedRows.length;
  const deletedSelectedCount = selectedDeletedArtifacts.length;
  const visibleKeys = useMemo(
    () => filteredRows.map((row) => artifactHubRowKey(row)),
    [filteredRows],
  );
  const visibleDeletedKeys = useMemo(
    () => filteredDeletedArtifacts.map(deletedArtifactKey),
    [filteredDeletedArtifacts],
  );
  const activeAllVisibleSelected =
    visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys.has(key));
  const deletedAllVisibleSelected =
    visibleDeletedKeys.length > 0 &&
    visibleDeletedKeys.every((key) => selectedDeletedKeys.has(key));

  useEffect(() => {
    const validKeys = new Set(rows.map((row) => artifactHubRowKey(row)));
    setSelectedKeys((current) => pruneSetKeys(current, validKeys));
  }, [rows]);

  useEffect(() => {
    const validKeys = new Set(deletedArtifacts.map(deletedArtifactKey));
    setSelectedDeletedKeys((current) => pruneSetKeys(current, validKeys));
  }, [deletedArtifacts]);

  const switchMode = (nextMode: ArtifactHubMode) => {
    setMode(nextMode);
    setSelectedKeys(new Set());
    setSelectedDeletedKeys(new Set());
  };

  const toggleRow = (key: string) => {
    setSelectedKeys((current) => toggleSetKey(current, key));
  };
  const toggleDeletedArtifact = (key: string) => {
    setSelectedDeletedKeys((current) => toggleSetKey(current, key));
  };
  const isTrashMode = mode === "trash";
  const selectVisible = () => {
    if (isTrashMode) {
      setSelectedDeletedKeys((current) =>
        addKeysToSet(current, visibleDeletedKeys),
      );
      return;
    }
    setSelectedKeys((current) => addKeysToSet(current, visibleKeys));
  };
  const clearSelection = () => {
    if (isTrashMode) setSelectedDeletedKeys(new Set());
    else setSelectedKeys(new Set());
  };
  const selectedCount = isTrashMode
    ? deletedSelectedCount
    : activeSelectedCount;
  const allVisibleSelected = isTrashMode
    ? deletedAllVisibleSelected
    : activeAllVisibleSelected;
  const currentVisibleCount = isTrashMode
    ? visibleDeletedKeys.length
    : visibleKeys.length;
  const selectedSummary =
    selectedCount === 0 ? "No artifacts selected" : `${selectedCount} selected`;
  const activeBulkTargets = selectedRows.map((row) => ({
    conversationId: row.sessionId,
    slug: row.artifact.slug,
  }));
  const deletedBulkTargets = selectedDeletedArtifacts.map((artifact) => ({
    conversationId: artifact.conversationId,
    slug: artifact.slug,
    undoToken: artifact.undoToken,
  }));

  return (
    <section
      aria-label="Artifact Hub"
      className={cn(
        "flex h-full min-h-0 flex-col rounded-md border bg-background",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-heading text-base font-semibold">Artifacts</h2>
          <p className="text-muted-foreground text-xs">
            Browse, search, and open artifacts across Pi sessions.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex rounded-full border bg-muted/20 p-0.5">
            <Button
              size="xs"
              type="button"
              variant={mode === "active" ? "secondary" : "ghost"}
              onClick={() => switchMode("active")}
            >
              Active
            </Button>
            <Button
              size="xs"
              type="button"
              variant={mode === "trash" ? "secondary" : "ghost"}
              onClick={() => switchMode("trash")}
            >
              Trash
            </Button>
          </div>
          <Badge variant="outline">
            {mode === "trash" ? deletedCount : artifactCount} artifact
            {(mode === "trash" ? deletedCount : artifactCount) === 1 ? "" : "s"}
          </Badge>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_380px]">
        <aside className="min-h-0 border-r bg-muted/10">
          <div className="border-b p-3">
            <div className="text-xs font-medium">Sessions</div>
            <div className="text-muted-foreground text-[11px]">
              Choose a conversation or view all.
            </div>
          </div>
          <ScrollArea className="h-full min-h-0">
            <div className="flex flex-col gap-1 p-2">
              <SessionButton
                count={artifactCount}
                label="All sessions"
                selected={selectedSessionId === "all"}
                onClick={() => setSelectedSessionId("all")}
              />
              {sessions.map((entry) => (
                <SessionButton
                  key={entry.conversationId}
                  count={entry.artifacts.length}
                  label={entry.sessionTitle}
                  selected={selectedSessionId === entry.conversationId}
                  onClick={() => setSelectedSessionId(entry.conversationId)}
                />
              ))}
            </div>
          </ScrollArea>
        </aside>

        <div className="flex min-h-0 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
            <input
              aria-label="Search artifacts"
              className="h-8 min-w-52 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Search title, slug, kind, or session…"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <div className="flex flex-wrap gap-1">
              {ARTIFACT_KINDS.map((nextKind) => (
                <Button
                  key={nextKind}
                  size="xs"
                  type="button"
                  variant={kind === nextKind ? "secondary" : "ghost"}
                  aria-pressed={kind === nextKind}
                  onClick={() => setKind(nextKind)}
                >
                  {nextKind === "all" ? "All" : nextKind}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-3 py-2 text-xs">
            <span className="text-muted-foreground">{selectedSummary}</span>
            <div className="flex flex-wrap gap-1">
              <Button
                size="xs"
                variant="ghost"
                disabled={allVisibleSelected || currentVisibleCount === 0}
                onClick={selectVisible}
              >
                Select visible
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={selectedCount === 0}
                onClick={clearSelection}
              >
                Clear
              </Button>
              {isTrashMode ? (
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={bulkBusy || deletedSelectedCount === 0}
                  onClick={() =>
                    onRestoreDeletedArtifacts?.(deletedBulkTargets)
                  }
                >
                  Restore selected
                </Button>
              ) : (
                <>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={bulkBusy || activeSelectedCount === 0}
                    onClick={() => onExportArtifacts?.(activeBulkTargets)}
                  >
                    Export selected
                  </Button>
                  <Button
                    size="xs"
                    variant="destructive"
                    disabled={bulkBusy || activeSelectedCount === 0}
                    onClick={() => onDeleteArtifacts?.(activeBulkTargets)}
                  >
                    Move to trash
                  </Button>
                  <Button
                    size="xs"
                    variant="secondary"
                    disabled={selectedRows.length === 0}
                    onClick={() => {
                      const first = selectedRows[0];
                      if (first)
                        onOpenArtifact(first.sessionId, first.artifact.slug);
                    }}
                  >
                    Open first
                  </Button>
                </>
              )}
            </div>
          </div>

          {error ? (
            <div className="border-b bg-destructive/5 px-3 py-2 text-destructive text-xs">
              Artifact hub failed to load: {error}
            </div>
          ) : null}

          <ScrollArea className="min-h-0 flex-1">
            {isTrashMode ? (
              <DeletedArtifactList
                artifacts={filteredDeletedArtifacts}
                error={deletedError}
                loading={deletedLoading}
                selectedKeys={selectedDeletedKeys}
                onPurge={onPurgeDeletedArtifact}
                onRestore={onRestoreDeletedArtifact}
                onToggleSelected={toggleDeletedArtifact}
              />
            ) : loading ? (
              <div className="p-4 text-muted-foreground text-sm">
                Loading artifacts…
              </div>
            ) : filteredRows.length > 0 ? (
              <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
                {filteredRows.map((row) => {
                  const rowKey = artifactHubRowKey(row);
                  const selected = selectedKeys.has(rowKey);
                  return (
                    <article
                      key={rowKey}
                      className={cn(
                        "rounded-xl border bg-card p-3 shadow-xs",
                        selected && "border-primary/50 bg-primary/5",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <label className="flex min-w-0 items-start gap-2">
                          <input
                            aria-label={`Select ${row.artifact.title}`}
                            checked={selected}
                            className="mt-1"
                            type="checkbox"
                            onChange={() => toggleRow(rowKey)}
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-heading text-sm font-medium">
                              {row.artifact.title}
                            </span>
                            <span className="block truncate text-muted-foreground text-xs">
                              {row.sessionTitle}
                            </span>
                          </span>
                        </label>
                        <Badge variant="outline">{row.artifact.kind}</Badge>
                      </div>
                      <div className="mt-2 rounded-lg bg-muted/30 p-2 text-muted-foreground text-[11px]">
                        <div className="truncate">
                          slug: {row.artifact.slug}
                        </div>
                        <div className="truncate">
                          content hash: {row.artifact.contentHash.slice(0, 12)}…
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                        <span>v{row.artifact.version}</span>
                        <span>{formatBytes(row.artifact.contentBytes)}</span>
                        <span>{formatDate(row.artifact.updatedAt)}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap justify-end gap-1">
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            onCopyMetadata?.(artifactMetadataSummary(row))
                          }
                        >
                          Copy ref
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            onPreviewArtifact?.(
                              row.sessionId,
                              row.artifact.slug,
                            )
                          }
                        >
                          Preview
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            onOpenArtifact(row.sessionId, row.artifact.slug)
                          }
                        >
                          Open
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <Empty className="m-3 border">
                <EmptyHeader>
                  <EmptyTitle>No artifacts found</EmptyTitle>
                  <EmptyDescription>
                    {sessions.length === 0
                      ? "Start a Pi session and create an artifact to populate this hub."
                      : "Try a different session, search, or kind filter."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </ScrollArea>
        </div>

        <aside className="flex min-h-0 flex-col border-l bg-muted/10">
          <div className="border-b p-3">
            <div className="text-xs font-medium">Preview selected artifact</div>
            <div className="truncate text-muted-foreground text-[11px]">
              {isTrashMode
                ? "Restore deleted artifacts before previewing."
                : previewTarget
                  ? `${previewTarget.conversationId}/${previewTarget.slug}`
                  : "Select Preview on a card to load content."}
            </div>
          </div>
          {isTrashMode ? (
            <Empty className="m-3 border bg-background">
              <EmptyHeader>
                <EmptyTitle>Trash is metadata-only</EmptyTitle>
                <EmptyDescription>
                  Restore an artifact before opening or previewing its content.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : previewLoading ? (
            <div className="p-4 text-muted-foreground text-sm">
              Loading preview…
            </div>
          ) : previewError ? (
            <div className="m-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive text-xs">
              Preview failed: {previewError}
            </div>
          ) : previewArtifact ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="grid gap-1 border-b p-3 text-[11px]">
                <MetadataRow
                  label="title"
                  value={previewArtifact.summary.title}
                />
                <MetadataRow
                  label="version"
                  value={`v${previewArtifact.summary.version}`}
                />
                <MetadataRow
                  label="content hash"
                  value={previewArtifact.summary.contentHash}
                />
              </div>
              <ArtifactPreviewFrame
                artifact={previewArtifact}
                className="min-h-0 flex-1 border-0"
              />
            </div>
          ) : (
            <Empty className="m-3 border bg-background">
              <EmptyHeader>
                <EmptyTitle>No preview selected</EmptyTitle>
                <EmptyDescription>
                  Preview loads one artifact at a time and keeps the hub list
                  metadata-only.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </aside>
      </div>
    </section>
  );
}

function DeletedArtifactList({
  artifacts,
  error,
  loading,
  selectedKeys,
  onPurge,
  onRestore,
  onToggleSelected,
}: {
  artifacts: DeletedArtifactSummary[];
  error: string | null;
  loading: boolean;
  selectedKeys: ReadonlySet<string>;
  onPurge?: (artifact: DeletedArtifactSummary) => void;
  onRestore?: (artifact: DeletedArtifactSummary) => void;
  onToggleSelected: (key: string) => void;
}) {
  if (error) {
    return (
      <div className="m-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive text-xs">
        Deleted artifacts failed to load: {error}
      </div>
    );
  }
  if (loading) {
    return (
      <div className="p-4 text-muted-foreground text-sm">
        Loading deleted artifacts…
      </div>
    );
  }
  if (artifacts.length === 0) {
    return (
      <Empty className="m-3 border">
        <EmptyHeader>
          <EmptyTitle>No deleted artifacts</EmptyTitle>
          <EmptyDescription>
            Deleted artifacts that can be restored will appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
      {artifacts.map((artifact) => {
        const artifactKey = deletedArtifactKey(artifact);
        const selected = selectedKeys.has(artifactKey);
        return (
          <article
            key={artifactKey}
            className={cn(
              "rounded-xl border bg-card p-3 shadow-xs",
              selected && "border-primary/50 bg-primary/5",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <label className="flex min-w-0 items-start gap-2">
                <input
                  aria-label={`Select deleted ${artifact.title}`}
                  checked={selected}
                  className="mt-1"
                  type="checkbox"
                  onChange={() => onToggleSelected(artifactKey)}
                />
                <span className="min-w-0">
                  <span className="block truncate font-heading text-sm font-medium">
                    {artifact.title}
                  </span>
                  <span className="block truncate text-muted-foreground text-xs">
                    Deleted artifacts • {artifact.conversationId}
                  </span>
                </span>
              </label>
              <Badge variant="outline">{artifact.kind}</Badge>
            </div>
            <div className="mt-2 rounded-lg bg-muted/30 p-2 text-muted-foreground text-[11px]">
              <div className="truncate">slug: {artifact.slug}</div>
              <div className="truncate">undo: {artifact.undoToken}</div>
              <div className="truncate">
                content hash: {artifact.contentHash.slice(0, 12)}…
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
              <span>v{artifact.version}</span>
              <span>{formatBytes(artifact.contentBytes)}</span>
              <span>{formatDate(artifact.deletedAt)}</span>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-1">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onRestore?.(artifact)}
              >
                Restore
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onPurge?.(artifact)}
              >
                Delete forever
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function SessionButton({
  count,
  label,
  selected,
  onClick,
}: {
  count: number;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
        selected && "bg-muted text-foreground",
      )}
      onClick={onClick}
    >
      <span className="truncate">{label}</span>
      <Badge variant="outline">{count}</Badge>
    </button>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono">{value}</span>
    </div>
  );
}

function artifactHubRowKey(row: ArtifactHubRow): string {
  return `${row.sessionId}:${row.artifact.slug}`;
}

function deletedArtifactKey(artifact: DeletedArtifactSummary): string {
  return `${artifact.conversationId}:${artifact.slug}:${artifact.undoToken}`;
}

function toggleSetKey(current: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function addKeysToSet(
  current: ReadonlySet<string>,
  keys: readonly string[],
): Set<string> {
  const next = new Set(current);
  for (const key of keys) next.add(key);
  return next;
}

function pruneSetKeys(
  current: ReadonlySet<string>,
  validKeys: ReadonlySet<string>,
): Set<string> {
  let changed = false;
  const next = new Set<string>();
  for (const key of current) {
    if (validKeys.has(key)) next.add(key);
    else changed = true;
  }
  return changed ? next : (current as Set<string>);
}

function filterDeletedArtifacts(
  artifacts: readonly DeletedArtifactSummary[],
  query: string,
  kind: ArtifactKind | "all",
): DeletedArtifactSummary[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return artifacts.filter((artifact) => {
    if (kind !== "all" && artifact.kind !== kind) return false;
    if (!normalizedQuery) return true;
    return [
      artifact.title,
      artifact.slug,
      artifact.kind,
      artifact.conversationId,
      artifact.undoToken,
    ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  });
}

function artifactMetadataSummary(row: ArtifactHubRow): string {
  return JSON.stringify(
    {
      conversationId: row.sessionId,
      slug: row.artifact.slug,
      title: row.artifact.title,
      kind: row.artifact.kind,
      version: row.artifact.version,
      contentHash: row.artifact.contentHash,
      updatedAt: row.artifact.updatedAt,
    },
    null,
    2,
  );
}

function copyMetadataToClipboard(summary: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard
    .writeText(summary)
    .then(() => toast.success("Artifact reference copied"))
    .catch((error: unknown) => {
      toast.error("Copy failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
