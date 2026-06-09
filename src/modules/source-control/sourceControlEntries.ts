import type { GitChangedFile } from "@/modules/ai/lib/native";

export type DiffMode = "+" | "-";

export type SourceControlEntry = {
  key: string;
  path: string;
  mode: DiffMode;
  indexStatus: string;
  worktreeStatus: string;
  statusLabel: string;
  statusCode: string;
  originalPath: string | null;
  untracked: boolean;
};

export type CheckState = "checked" | "indeterminate" | "unchecked";
export type SourceControlSection = "staged" | "unstaged";

/** One row per changed file (flat list) for bulk checkbox state. */
export type SourceControlFileEntry = {
  key: string;
  path: string;
  originalPath: string | null;
  statusCode: string;
  statusLabel: string;
  checkState: CheckState;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
};

export type SourceControlEntryModel = {
  stagedEntries: SourceControlEntry[];
  unstagedEntries: SourceControlEntry[];
  fileEntries: SourceControlFileEntry[];
  headerCheckState: CheckState;
};

export function entrySelectionKey(
  entry: Pick<SourceControlEntry, "mode" | "path">,
): string {
  return `${entry.mode}:${entry.path}`;
}

function normalizeStatusCode(status: string): string {
  const code = status.trim().toUpperCase();
  switch (code) {
    case "?":
      return "U";
    case "A":
      return "A";
    case "M":
      return "M";
    case "D":
      return "D";
    case "R":
    case "C":
      return "R";
    case "U":
      return "U";
    default:
      return code || "M";
  }
}

export function statusCodeForMode(
  mode: DiffMode,
  file: GitChangedFile,
): string {
  if (mode === "-" && file.untracked) return "U";
  const primary = mode === "+" ? file.indexStatus : file.worktreeStatus;
  const fallback = mode === "+" ? file.worktreeStatus : file.indexStatus;
  return normalizeStatusCode(primary !== " " ? primary : fallback);
}

export function makeSourceControlEntry(
  path: string,
  mode: DiffMode,
  file: GitChangedFile,
): SourceControlEntry {
  return {
    key: `${mode}:${path}`,
    path,
    mode,
    indexStatus: file.indexStatus,
    worktreeStatus: file.worktreeStatus,
    statusLabel: file.statusLabel,
    statusCode: statusCodeForMode(mode, file),
    originalPath: file.originalPath,
    untracked: file.untracked,
  };
}

function buildFileEntries(files: GitChangedFile[]): SourceControlFileEntry[] {
  const seen = new Set<string>();
  const out: SourceControlFileEntry[] = [];
  for (const file of files) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    const checkState: CheckState =
      file.staged && file.unstaged
        ? "indeterminate"
        : file.staged
          ? "checked"
          : "unchecked";
    const statusCode = file.unstaged
      ? statusCodeForMode("-", file)
      : statusCodeForMode("+", file);
    out.push({
      key: file.path,
      path: file.path,
      originalPath: file.originalPath,
      statusCode,
      statusLabel: file.statusLabel,
      checkState,
      staged: file.staged,
      unstaged: file.unstaged,
      untracked: file.untracked,
    });
  }
  return out;
}

export function getHeaderCheckState(
  fileEntries: SourceControlFileEntry[],
): CheckState {
  if (fileEntries.length === 0) return "unchecked";
  const allChecked = fileEntries.every((e) => e.checkState === "checked");
  if (allChecked) return "checked";
  const anyStaged = fileEntries.some((e) => e.staged);
  return anyStaged ? "indeterminate" : "unchecked";
}

export function buildSourceControlEntryModel(
  files: GitChangedFile[],
): SourceControlEntryModel {
  const stagedEntries = files
    .filter((file) => file.staged)
    .map((file) => makeSourceControlEntry(file.path, "+", file));
  const unstagedEntries = files
    .filter((file) => file.unstaged)
    .map((file) => makeSourceControlEntry(file.path, "-", file));
  const fileEntries = buildFileEntries(files);
  const headerCheckState = getHeaderCheckState(fileEntries);
  return { stagedEntries, unstagedEntries, fileEntries, headerCheckState };
}

export function resolveSectionBatchEntries(
  entries: SourceControlEntry[],
  markedKeys: Set<string>,
): SourceControlEntry[] {
  const marked = entries.filter((entry) =>
    markedKeys.has(entrySelectionKey(entry)),
  );
  return marked.length > 0 ? marked : entries;
}
