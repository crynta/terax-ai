import { GitDiffPane } from "@/modules/editor/GitDiffPane";
import type { GitCommitFileDiffTab, GitDiffTab } from "@/modules/tabs/lib/tabs";
import { memo } from "react";
import type { ViewProps } from "./types";

export default memo(function GitDiffView({
  tab,
}: ViewProps<GitDiffTab | GitCommitFileDiffTab>) {
  return (
    <div className="h-full w-full">
      {tab.kind === "git-diff" ? (
        <GitDiffPane
          active
          source={{
            kind: "working",
            repoRoot: tab.repoRoot,
            path: tab.path,
            mode: tab.mode,
            originalPath: tab.originalPath,
          }}
        />
      ) : (
        <GitDiffPane
          active
          source={{
            kind: "commit",
            repoRoot: tab.repoRoot,
            sha: tab.sha,
            path: tab.path,
            originalPath: tab.originalPath,
          }}
          chipLabel={tab.shortSha}
        />
      )}
    </div>
  );
});
