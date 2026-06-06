import { type MutableRefObject, useCallback, useRef } from "react";
import { native } from "@/modules/ai/lib/native";
import type { EditorPaneHandle } from "@/modules/editor";
import type { PreviewPaneHandle } from "@/modules/preview";
import type { TerminalPaneHandle } from "@/modules/terminal";

type UseAppSurfaceHandlesInput = {
  activeId: number;
  editorRefs: MutableRefObject<Map<number, EditorPaneHandle>>;
  focusInput: (sessionId: string | null) => void;
  focusPane: (tabId: number, leafId: number) => void;
  openPanel: () => void;
  previewRefs: MutableRefObject<Map<number, PreviewPaneHandle>>;
  setActiveEditorHandle: (handle: EditorPaneHandle | null) => void;
  setActiveId: (id: number) => void;
  setLeafCwd: (leafId: number, cwd: string) => void;
  terminalRefs: MutableRefObject<Map<number, TerminalPaneHandle>>;
  updateTab: (
    id: number,
    patch: { url?: string; customTitle?: string },
  ) => void;
};

export function useAppSurfaceHandles({
  activeId,
  editorRefs,
  focusInput,
  focusPane,
  openPanel,
  previewRefs,
  setActiveEditorHandle,
  setActiveId,
  setLeafCwd,
  terminalRefs,
  updateTab,
}: UseAppSurfaceHandlesInput) {
  const authorizedCwds = useRef(new Set<string>());

  const registerTerminalHandle = useCallback(
    (leafId: number, handle: TerminalPaneHandle | null) => {
      if (handle) terminalRefs.current.set(leafId, handle);
      else terminalRefs.current.delete(leafId);
    },
    [terminalRefs],
  );

  const registerEditorHandle = useCallback(
    (id: number, handle: EditorPaneHandle | null) => {
      if (handle) editorRefs.current.set(id, handle);
      else editorRefs.current.delete(id);
      if (id === activeId) setActiveEditorHandle(handle);
    },
    [activeId, editorRefs, setActiveEditorHandle],
  );

  const registerPreviewHandle = useCallback(
    (id: number, handle: PreviewPaneHandle | null) => {
      if (handle) previewRefs.current.set(id, handle);
      else previewRefs.current.delete(id);
    },
    [previewRefs],
  );

  const handlePreviewUrl = useCallback(
    (id: number, url: string) => updateTab(id, { url }),
    [updateTab],
  );

  const handleTerminalCwd = useCallback(
    (leafId: number, cwd: string) => {
      setLeafCwd(leafId, cwd);
      if (cwd && !authorizedCwds.current.has(cwd)) {
        authorizedCwds.current.add(cwd);
        native.workspaceAuthorize(cwd).catch(() => {
          authorizedCwds.current.delete(cwd);
        });
      }
    },
    [setLeafCwd],
  );

  const handleFocusLeaf = useCallback(
    (tabId: number, leafId: number) => focusPane(tabId, leafId),
    [focusPane],
  );

  const onActivateAgent = useCallback(
    (tabId: number, leafId: number) => {
      setActiveId(tabId);
      focusPane(tabId, leafId);
    },
    [focusPane, setActiveId],
  );

  const onActivateLocalAgent = useCallback(() => {
    openPanel();
    focusInput(null);
  }, [focusInput, openPanel]);

  return {
    handleFocusLeaf,
    handlePreviewUrl,
    handleTerminalCwd,
    onActivateAgent,
    onActivateLocalAgent,
    registerEditorHandle,
    registerPreviewHandle,
    registerTerminalHandle,
  };
}
