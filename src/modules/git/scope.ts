import type { CheckpointEndpoint, DiffSide, GitDiffScope } from "./types";

const SHORT_SHA = 7;

function shortRev(rev: string): string {
  return /^[0-9a-f]{40,64}$/i.test(rev) ? rev.slice(0, SHORT_SHA) : rev;
}

function checkpointRefLabel(name: string): string {
  const match = /^refs\/terax\/checkpoints\/[^/]+\/(\d+)$/.exec(name);
  return match ? `turn ${match[1]}` : shortRev(name);
}

function endpointLabel(endpoint: CheckpointEndpoint): string {
  return endpoint.kind === "worktree"
    ? "working tree"
    : checkpointRefLabel(endpoint.name);
}

/** Human label for a scope, as shown in the review view's scope picker. */
export function scopeLabel(scope: GitDiffScope): string {
  switch (scope.kind) {
    case "uncommitted":
      return "Uncommitted changes";
    case "staged":
      return "Staged changes";
    case "unstaged":
      return "Unstaged changes";
    case "range":
      return `${shortRev(scope.head)} vs ${shortRev(scope.base)}`;
    case "commit":
      return `Commit ${shortRev(scope.sha)}`;
    case "checkpoint": {
      const { from, to } = scope;
      if (to.kind === "worktree" && from.kind === "ref") {
        return `Since ${checkpointRefLabel(from.name)}`;
      }
      return `${endpointLabel(from)} to ${endpointLabel(to)}`;
    }
  }
}

/**
 * A stable identity for a scope, for cache keys and for deciding whether two
 * scope values mean the same diff. Field order never matters.
 */
export function scopeKey(scope: GitDiffScope): string {
  switch (scope.kind) {
    case "uncommitted":
    case "staged":
    case "unstaged":
      return scope.kind;
    case "range":
      return `range:${scope.base}...${scope.head}`;
    case "commit":
      return `commit:${scope.sha}`;
    case "checkpoint": {
      const end = (e: CheckpointEndpoint) =>
        e.kind === "worktree" ? "@worktree" : e.name;
      return `checkpoint:${end(scope.from)}..${end(scope.to)}`;
    }
  }
}

/**
 * Pins the live working-tree end of a checkpoint scope to the snapshot a
 * summary of that scope returned. Use the result for every `diffFile` call of
 * the same view: the files then agree with the summary and none of them takes
 * a new snapshot of the whole tree. Other scopes are returned as they are.
 */
export function freezeScope(
  scope: GitDiffScope,
  summary: { from: DiffSide; to: DiffSide },
): GitDiffScope {
  if (scope.kind !== "checkpoint") return scope;
  const pin = (end: CheckpointEndpoint, side: DiffSide): CheckpointEndpoint =>
    end.kind === "worktree" && side.kind === "worktree" && side.tree
      ? { kind: "worktree", tree: side.tree }
      : end;
  return {
    kind: "checkpoint",
    from: pin(scope.from, summary.from),
    to: pin(scope.to, summary.to),
  };
}

export function sameScope(a: GitDiffScope, b: GitDiffScope): boolean {
  return scopeKey(a) === scopeKey(b);
}

/**
 * True when the scope reads the live working tree or index, so its diff goes
 * stale on any file change; the others are fixed snapshots of history.
 */
export function isLiveScope(scope: GitDiffScope): boolean {
  switch (scope.kind) {
    case "uncommitted":
    case "staged":
    case "unstaged":
      return true;
    case "checkpoint":
      return scope.from.kind === "worktree" || scope.to.kind === "worktree";
    default:
      return false;
  }
}

/** The scopes per-hunk stage / unstage / revert can act on. */
export function supportsHunkActions(scope: GitDiffScope): {
  stage: boolean;
  unstage: boolean;
  revert: boolean;
} {
  return {
    stage: scope.kind === "unstaged",
    unstage: scope.kind === "staged",
    revert: scope.kind === "unstaged" || scope.kind === "uncommitted",
  };
}

/** The ref a checkpoint lives at, matching the backend's naming. */
export function checkpointRef(taskId: string, turn: number): string {
  return `refs/terax/checkpoints/${taskId}/${turn}`;
}

/** "Last agent turn": the previous checkpoint against the working tree. */
export function sinceCheckpointScope(ref: string): GitDiffScope {
  return {
    kind: "checkpoint",
    from: { kind: "ref", name: ref },
    to: { kind: "worktree" },
  };
}

/** "Turn N": checkpoint N-1 against checkpoint N. */
export function turnScope(fromRef: string, toRef: string): GitDiffScope {
  return {
    kind: "checkpoint",
    from: { kind: "ref", name: fromRef },
    to: { kind: "ref", name: toRef },
  };
}

/** "Task vs base branch": three-dot against the base branch. */
export function taskScope(baseBranch: string, head = "HEAD"): GitDiffScope {
  return { kind: "range", base: baseBranch, head };
}
