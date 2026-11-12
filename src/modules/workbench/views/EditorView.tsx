import { isMarkdownPath } from "@/lib/utils";
import { EditorPane, type EditorPaneHandle } from "@/modules/editor/EditorPane";
import { MarkdownViewToggle } from "@/modules/markdown/MarkdownViewToggle";
import type { EditorTab } from "@/modules/tabs/lib/tabs";
import { useWindowInactive } from "@/modules/theme/WindowActivityBridge";
import { memo, useCallback } from "react";
import { setMarkdownView, updateTab } from "../actions";
import { useWorkbenchChrome } from "../chrome";
import { canFocusTab } from "../viewFocus";
import { setViewHandle } from "../viewHandles";
import type { ViewProps } from "./types";

export default memo(function EditorView({
  tab,
  visible,
}: ViewProps<EditorTab>) {
  const id = tab.id;
  const { closeTab } = useWorkbenchChrome();
  const windowInactive = useWindowInactive();
  const setRef = useCallback(
    (handle: EditorPaneHandle | null) => setViewHandle(id, "editor", handle),
    [id],
  );
  const onDirtyChange = useCallback(
    (dirty: boolean) => updateTab(id, { dirty }),
    [id],
  );
  const canFocus = useCallback(() => canFocusTab(id), [id]);
  const onClose = useCallback(() => closeTab(id), [closeTab, id]);
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
        canFocus={canFocus}
        overrideLanguage={tab.overrideLanguage}
        onDirtyChange={onDirtyChange}
        onClose={onClose}
        mediaActive={visible && !windowInactive}
      />
    </div>
  );
});
