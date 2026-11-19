import {
  GitHistoryPane,
  type GitHistorySearchHandle,
} from "@/modules/git-history/GitHistoryPane";
import type { GitHistoryTab } from "@/modules/tabs/lib/tabs";
import { memo, useCallback } from "react";
import { openCommitFileDiff } from "../actions";
import { setViewHandle } from "../viewHandles";
import type { ViewProps } from "./types";

export default memo(function GitHistoryView({ tab }: ViewProps<GitHistoryTab>) {
  const id = tab.id;
  const onSearchHandle = useCallback(
    (handle: GitHistorySearchHandle | null) =>
      setViewHandle(id, "gitHistory", handle),
    [id],
  );
  return (
    <GitHistoryPane
      repoRoot={tab.repoRoot}
      onOpenCommitFile={openCommitFileDiff}
      onSearchHandle={onSearchHandle}
    />
  );
});
