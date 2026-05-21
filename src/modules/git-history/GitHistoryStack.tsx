import type { GitHistoryTab, Tab } from "@/modules/tabs";
import { GitHistoryPane, type GitHistorySearchHandle } from "./GitHistoryPane";

type CommitFileDiffOpenInput = {
  repoRoot: string;
  sha: string;
  shortSha: string;
  subject: string;
  path: string;
  originalPath: string | null;
};

type Props = {
  tabs: Tab[];
  activeId: number;
  onOpenCommitFile: (input: CommitFileDiffOpenInput) => void;
  onSearchHandle?: (handle: GitHistorySearchHandle | null) => void;
};

export function GitHistoryStack({
  tabs,
  activeId,
  onOpenCommitFile,
  onSearchHandle,
}: Props) {
  const active = tabs.find(
    (t): t is GitHistoryTab => t.kind === "git-history" && t.id === activeId,
  );
  if (!active) return null;
  return (
    <GitHistoryPane
      key={active.id}
      repoRoot={active.repoRoot}
      onOpenCommitFile={onOpenCommitFile}
      onSearchHandle={onSearchHandle}
    />
  );
}
