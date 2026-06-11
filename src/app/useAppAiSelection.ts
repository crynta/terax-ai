import { type MutableRefObject, useCallback, useEffect, useState } from "react";
import { useChatStore } from "@/modules/ai/store/chatStore";
import type { EditorPaneHandle } from "@/modules/editor";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import type { Tab } from "@/modules/tabs";
import type { TerminalPaneHandle } from "@/modules/terminal";

type UseAppAiSelectionInput = {
  activeId: number;
  activeTab: Tab | undefined;
  editorRefs: MutableRefObject<Map<number, EditorPaneHandle>>;
  focusInput: (sessionId: string | null) => void;
  hasComposer: boolean;
  openPanel: () => void;
  panelOpen: boolean;
  tabs: Tab[];
  terminalRefs: MutableRefObject<Map<number, TerminalPaneHandle>>;
};

export function useAppAiSelection({
  activeId,
  activeTab,
  editorRefs,
  focusInput,
  hasComposer,
  openPanel,
  panelOpen,
  tabs,
  terminalRefs,
}: UseAppAiSelectionInput) {
  const [askPopup, setAskPopup] = useState<{ x: number; y: number } | null>(
    null,
  );

  const captureActiveSelection = useCallback((): string | null => {
    const tab = tabs.find((candidate) => candidate.id === activeId);
    if (!tab) return null;
    if (tab.kind === "terminal") {
      return terminalRefs.current.get(tab.activeLeafId)?.getSelection() ?? null;
    }
    if (tab.kind === "editor") {
      return editorRefs.current.get(activeId)?.getSelection() ?? null;
    }
    return null;
  }, [activeId, editorRefs, tabs, terminalRefs]);

  const togglePanelAndFocus = useCallback(() => {
    if (!hasComposer) {
      void openSettingsWindow("models");
      return;
    }
    if (panelOpen) {
      useChatStore.getState().closePanel();
    } else {
      openPanel();
      focusInput(null);
    }
  }, [hasComposer, panelOpen, openPanel, focusInput]);

  const attachSelection = useChatStore((state) => state.attachSelection);

  const handleAttachFileToAgent = useCallback(
    (path: string) => {
      if (!hasComposer) {
        void openSettingsWindow("models");
        return;
      }
      // Dispatch a window event the composer listens for. Same pattern as
      // selections - keeps file-explorer decoupled from the AI module.
      window.dispatchEvent(
        new CustomEvent<string>("terax:ai-attach-file", { detail: path }),
      );
      openPanel();
      focusInput(null);
    },
    [hasComposer, openPanel, focusInput],
  );

  const askFromSelection = useCallback(() => {
    if (!hasComposer) {
      void openSettingsWindow("models");
      return;
    }
    const selection = captureActiveSelection();
    if (!selection?.trim()) {
      focusInput(null);
      return;
    }
    const source: "terminal" | "editor" =
      activeTab?.kind === "editor" ? "editor" : "terminal";
    attachSelection(selection, source);
  }, [
    activeTab,
    attachSelection,
    captureActiveSelection,
    focusInput,
    hasComposer,
  ]);

  useEffect(() => {
    const isInsideAi = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      return !!(
        element.closest("[data-selection-ask-ai]") ||
        element.closest("[data-ai-input-bar]") ||
        element.closest("[data-ai-mini-window]")
      );
    };

    const onDown = (event: MouseEvent) => {
      if (isInsideAi(event.target)) return;
      setAskPopup(null);
    };
    const onUp = (event: MouseEvent) => {
      if (isInsideAi(event.target)) return;
      const element = event.target as HTMLElement | null;
      const inContentArea = element?.closest?.(".xterm, .cm-editor");
      if (!inContentArea) return;
      // Defer one tick so xterm/CodeMirror finalize the selection.
      setTimeout(() => {
        const text = captureActiveSelection();
        if (text && text.trim().length > 0) {
          setAskPopup({ x: event.clientX, y: event.clientY });
        } else {
          setAskPopup(null);
        }
      }, 0);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("mouseup", onUp);
    };
  }, [captureActiveSelection]);

  const onAskFromSelection = useCallback(() => {
    askFromSelection();
    setAskPopup(null);
  }, [askFromSelection]);

  return {
    askFromSelection,
    askPopup,
    captureActiveSelection,
    dismissAskPopup: () => setAskPopup(null),
    handleAttachFileToAgent,
    onAskFromSelection,
    togglePanelAndFocus,
  };
}
