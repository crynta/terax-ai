type TabBase = {
  /** Project the tab belongs to (the space id it was created in). */
  spaceId: string;
  /** Restored from disk, not yet shown: rendered as a placeholder, not mounted. */
  cold?: boolean;
};

/** One terminal session. Its id is also the session's leaf id. */
export type TerminalTab = TabBase & {
  id: number;
  kind: "terminal";
  title: string;
  cwd?: string;
  blocks?: boolean;
  /** AI agent cannot read buffer / context of this terminal. */
  private?: boolean;
  /** User-set label that overrides the cwd-derived name. Survives cd. */
  customTitle?: string;
};

export type EditorTab = TabBase & {
  id: number;
  kind: "editor";
  title: string;
  path: string;
  dirty: boolean;
  /**
   * True while the tab is in the transient "preview" state — opened by a
   * single-click in the explorer and not yet pinned by the user. A preview tab
   * is replaced by the next single-click rather than accumulating.
   */
  preview: boolean;
  overrideLanguage?: string | null;
};

export type PreviewTab = TabBase & {
  id: number;
  kind: "preview";
  title: string;
  url: string;
};

export type MarkdownTab = TabBase & {
  id: number;
  kind: "markdown";
  title: string;
  path: string;
  overrideLanguage?: string | null;
};

export type AiDiffStatus = "pending" | "approved" | "rejected";

export type AiDiffTab = TabBase & {
  id: number;
  kind: "ai-diff";
  title: string;
  path: string;
  /** "" for newly created files. */
  originalContent: string;
  proposedContent: string;
  /** Tool-call approval id used to resolve the AI SDK approval. */
  approvalId: string;
  status: AiDiffStatus;
  isNewFile: boolean;
};

export type GitDiffTab = TabBase & {
  id: number;
  kind: "git-diff";
  title: string;
  path: string;
  repoRoot: string;
  mode: "-" | "+";
  originalPath: string | null;
  preview: boolean;
};

export type GitHistoryTab = TabBase & {
  id: number;
  kind: "git-history";
  title: string;
  repoRoot: string;
};

export type GitCommitFileDiffTab = TabBase & {
  id: number;
  kind: "git-commit-file";
  title: string;
  repoRoot: string;
  sha: string;
  shortSha: string;
  subject: string;
  path: string;
  originalPath: string | null;
};

export type Tab =
  | TerminalTab
  | EditorTab
  | PreviewTab
  | MarkdownTab
  | AiDiffTab
  | GitDiffTab
  | GitHistoryTab
  | GitCommitFileDiffTab;

export type TabKind = Tab["kind"];

export type TabPatch = Partial<{
  title: string;
  cwd: string;
  path: string;
  dirty: boolean;
  url: string;
  /** Empty string resets a terminal tab to its cwd-derived name. */
  customTitle: string;
  overrideLanguage: string | null;
}>;

export type GitDiffOpenInput = {
  path: string;
  repoRoot: string;
  mode: "-" | "+";
  originalPath?: string | null;
  title?: string;
};

export type CommitFileDiffInput = {
  repoRoot: string;
  sha: string;
  shortSha: string;
  subject: string;
  path: string;
  originalPath: string | null;
};

export type AiDiffInput = {
  path: string;
  originalContent: string;
  proposedContent: string;
  approvalId: string;
  isNewFile: boolean;
};

export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

export function titleFromUrl(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url || "preview";
  }
}

/** Tabs that are transient previews, replaced by the next preview open. */
export function isPreviewTab(tab: Tab): boolean {
  return (tab.kind === "editor" || tab.kind === "git-diff") && tab.preview;
}

/**
 * Applies a patch to a tab. Returns the same object when nothing changed, so
 * a store update can bail out (shell integration re-reports the cwd on every
 * prompt).
 */
export function patchTab(tab: Tab, patch: TabPatch): Tab {
  let next: Tab;
  switch (tab.kind) {
    case "terminal": {
      const customTitle =
        patch.customTitle === undefined
          ? tab.customTitle
          : patch.customTitle === ""
            ? undefined
            : patch.customTitle;
      next = {
        ...tab,
        title: patch.title ?? tab.title,
        cwd: patch.cwd ?? tab.cwd,
        customTitle,
      };
      if (customTitle === undefined) delete next.customTitle;
      if (next.cwd === undefined) delete next.cwd;
      break;
    }
    case "preview":
      next =
        patch.url !== undefined
          ? {
              ...tab,
              url: patch.url,
              title: patch.title ?? titleFromUrl(patch.url),
            }
          : { ...tab, title: patch.title ?? tab.title };
      break;
    case "markdown":
      next = {
        ...tab,
        title: patch.title ?? tab.title,
        path: patch.path ?? tab.path,
      };
      break;
    case "editor":
      next = {
        ...tab,
        // A preview tab becomes persistent the moment it gets unsaved edits.
        preview: patch.dirty === true ? false : tab.preview,
        title: patch.title ?? tab.title,
        dirty: patch.dirty ?? tab.dirty,
        path: patch.path ?? tab.path,
        overrideLanguage:
          patch.overrideLanguage !== undefined
            ? patch.overrideLanguage
            : tab.overrideLanguage,
      };
      if (next.overrideLanguage === undefined) delete next.overrideLanguage;
      break;
    default:
      next = {
        ...tab,
        title: patch.title ?? tab.title,
        ...("path" in tab && patch.path !== undefined && { path: patch.path }),
      } as Tab;
  }
  return shallowEqual(tab, next) ? tab : next;
}

function shallowEqual(a: object, b: object): boolean {
  const ak = Object.keys(a) as (keyof typeof a)[];
  const bk = Object.keys(b) as (keyof typeof b)[];
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}
