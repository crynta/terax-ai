import {
  PreviewPane,
  type PreviewPaneHandle,
} from "@/modules/preview/PreviewPane";
import type { PreviewTab } from "@/modules/tabs/lib/tabs";
import { memo, useCallback } from "react";
import { updateTab } from "../actions";
import { setViewHandle } from "../viewHandles";
import type { ViewProps } from "./types";

export default memo(function PreviewView({
  tab,
  visible,
}: ViewProps<PreviewTab>) {
  const id = tab.id;
  const setRef = useCallback(
    (handle: PreviewPaneHandle | null) => setViewHandle(id, "preview", handle),
    [id],
  );
  const onUrlChange = useCallback(
    (url: string) => updateTab(id, { url }),
    [id],
  );
  return (
    <PreviewPane
      ref={setRef}
      url={tab.url}
      visible={visible}
      onUrlChange={onUrlChange}
    />
  );
});
