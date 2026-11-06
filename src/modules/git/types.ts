export type GitRepoInfo = {
  repoRoot: string;
  branch: string;
  upstream: string | null;
  isDetached: boolean;
};

export type GitChangedFile = {
  path: string;
  originalPath: string | null;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  statusLabel: string;
};

export type GitStatusSnapshot = {
  repoRoot: string;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  isDetached: boolean;
  truncated: boolean;
  changedFiles: GitChangedFile[];
};

export type GitDiffResult = {
  diffText: string;
  truncated: boolean;
};

export type GitDiffContentResult = {
  originalContent: string;
  modifiedContent: string;
  isBinary: boolean;
  fallbackPatch: string;
  truncated: boolean;
};

export type GitCommitResult = {
  commitSha: string;
  summary: string;
};

export type GitPushResult = {
  remote: string | null;
  branch: string | null;
  pushed: boolean;
};

export type GitLogEntry = {
  sha: string;
  shortSha: string;
  author: string;
  authorEmail: string;
  timestampSecs: number;
  parents: string[];
  subject: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
};

export type GitCommitFileChange = {
  path: string;
  originalPath: string | null;
  status: string;
  statusLabel: string;
  added: number;
  removed: number;
  isBinary: boolean;
};

export type GitPanelSnapshot = {
  repo: GitRepoInfo | null;
  status: GitStatusSnapshot | null;
};

export type GitDiscardEntry = {
  path: string;
  untracked: boolean;
};

export type GitBranchEntry = {
  name: string;
  kind: "local" | "worktree";
  worktreePath: string | null;
  isHead: boolean;
  isDetached: boolean;
};

export type GitBranchListResult = {
  branches: GitBranchEntry[];
};

// ---------------------------------------------------------------- review

export type CheckpointEndpoint =
  | { kind: "ref"; name: string }
  /**
   * The live working tree. Without `tree` it is snapshotted on every call;
   * pass the `tree` a summary returned (`freezeScope`) so the file diffs of one
   * view agree with it and none of them walks the whole tree again.
   */
  | { kind: "worktree"; tree?: string };

/** What the review view is looking at. */
export type GitDiffScope =
  | { kind: "uncommitted" }
  | { kind: "staged" }
  | { kind: "unstaged" }
  | { kind: "range"; base: string; head: string }
  | { kind: "commit"; sha: string }
  | { kind: "checkpoint"; from: CheckpointEndpoint; to: CheckpointEndpoint };

type GitFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typeChanged"
  | "unmerged"
  | "untracked";

export type DiffSide =
  | { kind: "rev"; id: string }
  | { kind: "index" }
  | { kind: "worktree"; tree?: string };

type DiffFileSummary = {
  path: string;
  oldPath: string | null;
  status: GitFileStatus;
  added: number;
  removed: number;
  binary: boolean;
  submodule: boolean;
  symlink: boolean;
  /** Line counts were not computed (untracked file over its budget). */
  approximate: boolean;
};

type DiffTotals = {
  files: number;
  added: number;
  removed: number;
  binary: number;
};

export type GitDiffSummary = {
  files: DiffFileSummary[];
  totals: DiffTotals;
  truncated: boolean;
  untrackedTruncated: boolean;
  from: DiffSide;
  to: DiffSide;
  mergeBase: string | null;
};

type DiffLineKind = "context" | "add" | "remove";

export type DiffLine = {
  kind: DiffLineKind;
  /** Without the leading marker; a CRLF file keeps its trailing `\r`. */
  text: string;
  oldLine: number | null;
  newLine: number | null;
  /** A "\ No newline at end of file" marker follows this line. */
  noNewline: boolean;
};

export type DiffHunk = {
  /** Content-derived; apply calls select hunks by it. */
  id: string;
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
  added: number;
  removed: number;
};

type ContentsOmitted = "tooLarge" | "binary" | "submodule" | "disabled";

export type GitFileDiff = {
  path: string;
  oldPath: string | null;
  status: GitFileStatus;
  /** The file has no changes in this scope (the view was stale). */
  unchanged: boolean;
  binary: boolean;
  submodule: boolean;
  symlink: boolean;
  added: number;
  removed: number;
  hunks: DiffHunk[];
  fingerprint: string;
  /** The patch hit its cap; `hunks` holds only the complete leading hunks. */
  truncated: boolean;
  contents: { original: string; modified: string } | null;
  contentsOmitted: ContentsOmitted | null;
  from: DiffSide;
  to: DiffSide;
};

type ApplyMode = "stage" | "unstage" | "revert";

export type HunkSelection = {
  id: string;
  /** Indices into the hunk's `lines`; omitted takes the whole hunk. */
  lines?: number[];
};

export type ApplySelection =
  | { kind: "file" }
  | { kind: "hunks"; items: HunkSelection[] };

export type ApplyHunksRequest = {
  scope: GitDiffScope;
  path: string;
  oldPath?: string | null;
  mode: ApplyMode;
  selection: ApplySelection;
};

type ApplyRefusalCode =
  | "unchanged"
  | "staleHunks"
  | "wholeFileOnly"
  | "unsupportedScope"
  | "invalidSelection"
  | "patchRejected"
  | "needsSeparateScopes";

/** Nothing is changed when `applied` is false. */
export type ApplyOutcome = {
  applied: boolean;
  refusal: {
    code: ApplyRefusalCode;
    message: string;
    hunkIds: string[];
  } | null;
};

// ------------------------------------------------------------ worktrees

export type WorktreeEntry = {
  path: string;
  branch: string | null;
  head: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockReason: string | null;
  prunable: boolean;
  prunableReason: string | null;
  isMain: boolean;
  exists: boolean;
};

type WorktreeBranch =
  | { mode: "newBranch"; name: string }
  | { mode: "existingBranch"; name: string }
  | { mode: "detach" };

export type WorktreeAddRequest = {
  /** Absolute location; omitted: `~/.terax/worktrees/<project>/<task>`. */
  path?: string | null;
  taskSlug?: string | null;
  branch: WorktreeBranch;
  base?: string | null;
  /** Globs of ignored files to copy in (e.g. `.env`), relative to the repo. */
  include?: string[];
};

type SkippedPath = { path: string; reason: string };

export type WorktreeAdded = {
  path: string;
  branch: string | null;
  head: string;
  detached: boolean;
  copied: string[];
  skipped: SkippedPath[];
  includeTruncated: boolean;
};

type ChangedPath = { path: string; status: GitFileStatus };

/**
 * `ignored`: files git ignores but that are not regenerable (`.env`, local
 * databases), which removal would delete without a word.
 */
type WorktreeRemoveBlocker =
  | "locked"
  | "dirty"
  | "unmerged"
  | "ignored"
  | "inconclusive";

export type WorktreeRemoveReport = {
  removed: boolean;
  path: string;
  branch: string | null;
  blockers: WorktreeRemoveBlocker[];
  dirtyFiles: ChangedPath[];
  dirtyTotal: number;
  untrackedCount: number;
  unmergedCommits: number;
  /** A sample of the ignored, non-regenerable entries, and how many there are. */
  ignoredFiles: string[];
  ignoredTotal: number;
  /** Ignored dependency / cache entries (`node_modules`, `target`...): not blockers. */
  ignoredRegenerable: number;
  /** Ignored entries byte-identical to the main checkout's copy (what `include` copied in and nobody changed): not blockers. */
  ignoredIdentical: number;
  /** Safety probes that could not finish (`ignored-files`, `unmerged-commits`); removal is refused until they can, unless forced. */
  inconclusive: string[];
  lockReason: string | null;
};

export type WorktreePruneReport = { pruned: string[] };

// ---------------------------------------------------------- checkpoints

export type CheckpointInfo = {
  ref: string;
  taskId: string;
  turn: number;
  commit: string;
  tree: string;
  parent: string | null;
  createdAtSecs: number;
};

type CheckpointLimits = {
  atomic: boolean;
  capturesIgnoredFiles: boolean;
  capturesSubmoduleContents: boolean;
  capturesIndexState: boolean;
};

export type CheckpointCreated = CheckpointInfo & {
  /** Two consecutive snapshot passes produced the same tree. */
  consistent: boolean;
  passes: number;
  warnings: string[];
  /** Files that kept changing under the snapshot and were left out. */
  unstablePaths: string[];
  limits: CheckpointLimits;
  durationMs: number;
};

export type RestoreReport = {
  restored: boolean;
  refusal: "changedSinceLatest" | null;
  latestRef: string | null;
  /**
   * What `dirty` was measured against: the last restore's target when a restore
   * happened after the latest checkpoint (so restoring forward is not refused),
   * otherwise `latestRef`.
   */
  baselineRef: string | null;
  dirty: ChangedPath[];
  dirtyTotal: number;
  written: number;
  removed: number;
  skipped: SkippedPath[];
  headMoved: boolean;
  indexSynced: boolean;
  consistent: boolean;
  /** Files that kept changing under the pre-restore snapshot and were left out. */
  unstablePaths: string[];
  /**
   * The working tree as it was before this restore, kept under a ref. Restoring
   * `safety.ref` undoes the restore. Present whenever the restore could drop
   * work that no turn checkpoint holds (always when forced).
   */
  safety: SafetySnapshot | null;
  atomic: boolean;
};

type SafetySnapshot = { ref: string; commit: string; tree: string };

// ------------------------------------------------------------- branches

export type BranchCreated = { name: string; commit: string };

export type UpstreamInfo = {
  branch: string | null;
  detached: boolean;
  upstream: string | null;
  remote: string | null;
  remoteBranch: string | null;
  remoteUrl: string | null;
  ahead: number;
  behind: number;
  /** An upstream is configured but its remote-tracking ref is gone. */
  gone: boolean;
  hasRemotes: boolean;
  suggestedRemote: string | null;
};

// ---------------------------------------------------------------- watch

export type GitChangeKind = "head" | "index" | "refs" | "worktree";

export type GitWatchInfo = {
  watching: boolean;
  repo: string;
  watchedDirs: number;
  truncated: boolean;
  reason: string | null;
};

export type GitChangedEvent = { repo: string; kinds: GitChangeKind[] };

export type ProjectConfig = {
  worktree: {
    dir: string;
    include: string[];
    shared: string[];
    branchPrefix: string;
  };
  scripts: {
    setup: string;
    run: string;
    archive: string;
    runMode: "concurrent" | "exclusive";
  };
  ports: { base: number; perTask: number };
  layout: { default: { cards: string[] } };
  actions: { name: string; run: string }[];
};

type TaskBase =
  | { kind: "current" }
  | { kind: "branch"; name: string }
  | { kind: "origin"; branch: string };

export type TaskCreateRequest = { name: string; base?: TaskBase | null };

type TaskSnapshot = {
  reference: string;
  commit: string;
  parent: string;
  capturesIgnoredFiles: boolean;
};

export type TaskWorktree = {
  id: string;
  name: string;
  root: string;
  path: string;
  branch: string;
  status: "creating" | "active" | "archived";
  port: number;
  portCount: number;
  snapshot: TaskSnapshot | null;
  archiveScript: string;
  include: string[];
  shared: string[];
};

export type TaskCreated = {
  task: TaskWorktree;
  env: Record<string, string>;
  setupScript: string;
  copied: string[];
  shared: string[];
  skipped: { path: string; reason: string }[];
  includeTruncated: boolean;
};

export type TaskArchive = {
  task: TaskWorktree;
  snapshot: TaskSnapshot;
  removal: WorktreeRemoveReport;
  archiveScript: string;
};

export type TaskDiskUsage = {
  bytes: number;
  entries: number;
  truncated: boolean;
};
