import { useCallback, useRef, useState } from "react";
import type { PiChatFocusRequest } from "@/modules/pi/PiChatPanel";
import type { PiFocusRequest } from "@/modules/pi/PiPanel";
import type { SecondarySidebarViewId } from "@/modules/sidebar";
import type { Tab } from "@/modules/tabs";
import {
  type CodePanelContext,
  type CodeSurface,
  codePanelMounts,
  shouldCollapseSecondarySidebarForCodeMove,
  surfaceForSecondarySidebarSelection,
} from "./codeSurface";

type UseCodeSurfaceManagerInput = {
  activeTabKind: Tab["kind"] | null | undefined;
  closeSecondarySidebarPanel: () => void;
  openPiWorkspaceTab: () => number;
  openSecondarySidebarView: (view: SecondarySidebarViewId) => void;
  persistSecondarySidebarView: (view: SecondarySidebarViewId) => void;
  secondarySidebarView: SecondarySidebarViewId;
  secondarySidebarVisible: boolean;
};

export function useCodeSurfaceManager({
  activeTabKind,
  closeSecondarySidebarPanel,
  openPiWorkspaceTab,
  openSecondarySidebarView,
  persistSecondarySidebarView,
  secondarySidebarView,
  secondarySidebarVisible,
}: UseCodeSurfaceManagerInput) {
  const [piFocusRequest, setPiFocusRequest] = useState<PiFocusRequest | null>(
    null,
  );
  const [codeSurface, setCodeSurface] = useState<CodeSurface>("sidebar");
  const [capturedCodeContext, setCapturedCodeContext] =
    useState<CodePanelContext | null>(null);
  const codeContextRef = useRef<CodePanelContext | null>(null);
  const [codeSelectedSessionId, setCodeSelectedSessionId] = useState<
    string | null
  >(null);
  const [chatSelectedSessionId, setChatSelectedSessionId] = useState<
    string | null
  >(null);
  const [chatFocusRequest, setChatFocusRequest] =
    useState<PiChatFocusRequest | null>(null);

  const chatSidebarVisible =
    secondarySidebarVisible && secondarySidebarView === "chat";
  const codePanelVisibility = codePanelMounts({
    surface: codeSurface,
    secondarySidebarView,
    secondarySidebarVisible,
    activeTabKind,
  });
  const codePanelVisible =
    codePanelVisibility.sidebar ||
    codePanelVisibility.floating ||
    codePanelVisibility.workspace;
  const piSidebarVisible =
    codePanelVisibility.sidebar ||
    codePanelVisibility.floating ||
    codePanelVisibility.workspace;

  const focusCurrentCodeSession = useCallback(() => {
    if (!codeSelectedSessionId) return;
    setPiFocusRequest({ sessionId: codeSelectedSessionId, token: Date.now() });
  }, [codeSelectedSessionId]);

  const openCodeInSidebar = useCallback(() => {
    setCodeSurface("sidebar");
    openSecondarySidebarView("code");
    focusCurrentCodeSession();
  }, [focusCurrentCodeSession, openSecondarySidebarView]);

  const openCodePopOut = useCallback(() => {
    setCapturedCodeContext(codeContextRef.current);
    setCodeSurface("floating");
    if (
      shouldCollapseSecondarySidebarForCodeMove(
        secondarySidebarView,
        "floating",
      )
    ) {
      closeSecondarySidebarPanel();
    }
    focusCurrentCodeSession();
  }, [
    closeSecondarySidebarPanel,
    focusCurrentCodeSession,
    secondarySidebarView,
  ]);

  const openCodeWorkspace = useCallback(() => {
    setCapturedCodeContext(codeContextRef.current);
    openPiWorkspaceTab();
    setCodeSurface("workspace");
    if (
      shouldCollapseSecondarySidebarForCodeMove(
        secondarySidebarView,
        "workspace",
      )
    ) {
      closeSecondarySidebarPanel();
    }
    focusCurrentCodeSession();
  }, [
    closeSecondarySidebarPanel,
    focusCurrentCodeSession,
    openPiWorkspaceTab,
    secondarySidebarView,
  ]);

  const selectSecondarySidebarView = useCallback(
    (view: SecondarySidebarViewId) => {
      const nextCodeSurface = surfaceForSecondarySidebarSelection(view);
      if (nextCodeSurface) setCodeSurface(nextCodeSurface);
      persistSecondarySidebarView(view);
    },
    [persistSecondarySidebarView],
  );

  return {
    capturedCodeContext,
    chatFocusRequest,
    chatSelectedSessionId,
    chatSidebarVisible,
    codeContextRef,
    codePanelVisibility,
    codePanelVisible,
    codeSelectedSessionId,
    codeSurface,
    focusCurrentCodeSession,
    openCodeInSidebar,
    openCodePopOut,
    openCodeWorkspace,
    piFocusRequest,
    piSidebarVisible,
    selectSecondarySidebarView,
    setCapturedCodeContext,
    setChatFocusRequest,
    setChatSelectedSessionId,
    setCodeSelectedSessionId,
    setCodeSurface,
    setPiFocusRequest,
  };
}
