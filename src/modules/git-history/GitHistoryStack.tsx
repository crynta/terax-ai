import type { GitHistoryTab, Tab } from "@/modules/tabs";
import { GitHistoryPane } from "./GitHistoryPane";

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
};

export function GitHistoryStack({ tabs, activeId, onOpenCommitFile }: Props) {
  const active = tabs.find(
    (t): t is GitHistoryTab => t.kind === "git-history" && t.id === activeId,
  );
  if (!active) return null;
  const branch = active.title.startsWith("History · ")
    ? active.title.slice("History · ".length)
    : null;
  return (
    <GitHistoryPane
      key={active.id}
      repoRoot={active.repoRoot}
      branch={branch}
      onOpenCommitFile={onOpenCommitFile}
    />
  );
}
