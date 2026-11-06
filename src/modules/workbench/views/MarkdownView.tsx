import { MarkdownPreviewPane } from "@/modules/markdown/MarkdownPreviewPane";
import type { MarkdownTab } from "@/modules/tabs/lib/tabs";
import { memo } from "react";
import { useSpaces } from "@/modules/spaces/lib/useSpaces";
import { locateTab } from "../model/workbench";
import { useWorkbench } from "../store";
import { setMarkdownView } from "../actions";
import type { ViewProps } from "./types";

export default memo(function MarkdownView({
  tab,
  visible,
}: ViewProps<MarkdownTab>) {
  const taskRoot = useWorkbench((s) => locateTab(s, tab.id)?.task.cwd);
  const projectRoot = useSpaces(
    (s) => s.spaces.find((p) => p.id === tab.spaceId)?.root,
  );
  return (
    <div className="relative h-full overflow-hidden bg-background">
      <MarkdownPreviewPane
        path={tab.path}
        workspaceRoot={taskRoot ?? projectRoot}
        visible={visible}
        onSetView={(mode) => setMarkdownView(tab.id, mode)}
      />
    </div>
  );
});
