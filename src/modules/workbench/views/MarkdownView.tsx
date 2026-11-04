import { MarkdownPreviewPane } from "@/modules/markdown/MarkdownPreviewPane";
import type { MarkdownTab } from "@/modules/tabs/lib/tabs";
import { memo } from "react";
import { setMarkdownView } from "../actions";
import type { ViewProps } from "./types";

export default memo(function MarkdownView({
  tab,
  visible,
}: ViewProps<MarkdownTab>) {
  return (
    <div className="relative h-full overflow-hidden bg-background">
      <MarkdownPreviewPane
        path={tab.path}
        visible={visible}
        onSetView={(mode) => setMarkdownView(tab.id, mode)}
      />
    </div>
  );
});
