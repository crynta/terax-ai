import { isMarkdownPath } from "@/lib/utils";
import { EditorPane, type EditorPaneHandle } from "@/modules/editor/EditorPane";
import { MarkdownViewToggle } from "@/modules/markdown/MarkdownViewToggle";
import type { EditorTab } from "@/modules/tabs/lib/tabs";
import { useWindowInactive } from "@/modules/theme/WindowActivityBridge";
import { memo, useCallback } from "react";
import { closeTabsNow, setMarkdownView, updateTab } from "../actions";
import { setViewHandle } from "../viewHandles";
import type { ViewProps } from "./types";

export default memo(function EditorView({
  tab,
  visible,
}: ViewProps<EditorTab>) {
  const id = tab.id;
  const windowInactive = useWindowInactive();
  const setRef = useCallback(
    (handle: EditorPaneHandle | null) => setViewHandle(id, "editor", handle),
    [id],
  );
  const onDirtyChange = useCallback(
    (dirty: boolean) => updateTab(id, { dirty }),
    [id],
  );
  const onClose = useCallback(() => closeTabsNow([id]), [id]);
  return (
    <div className="relative h-full overflow-hidden bg-background">
      {isMarkdownPath(tab.path) && (
        <MarkdownViewToggle
          mode="raw"
          onChange={(mode) => setMarkdownView(id, mode)}
          renderedDisabled={tab.dirty}
          renderedHint="Save to preview"
        />
      )}
      <EditorPane
        ref={setRef}
        path={tab.path}
        overrideLanguage={tab.overrideLanguage}
        onDirtyChange={onDirtyChange}
        onClose={onClose}
        mediaActive={visible && !windowInactive}
      />
    </div>
  );
});
