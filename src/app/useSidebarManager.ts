import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import {
  defaultSidebarVisibility,
  normalizePrimarySidebarView,
  normalizeSecondarySidebarView,
  type PrimarySidebarViewId,
  readStoredSidebarWidth,
  resolveSidebarResize,
  resolveSidebarViewSelection,
  type SecondarySidebarViewId,
  SIDEBAR_STORAGE_KEYS,
  type SidebarSlotId,
  type SidebarViewPair,
  writeStoredSidebarWidth,
} from "@/modules/sidebar";

function readStoredString(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readStoredBoolean(key: string): boolean | null {
  const stored = readStoredString(key);
  if (stored === "true") return true;
  if (stored === "false") return false;
  return null;
}

function readSidebarViews(): SidebarViewPair {
  return {
    primary: normalizePrimarySidebarView(
      readStoredString(SIDEBAR_STORAGE_KEYS.primaryView),
    ),
    secondary: normalizeSecondarySidebarView(
      readStoredString(SIDEBAR_STORAGE_KEYS.secondaryView),
    ),
  };
}

function readSecondarySidebarVisible(): boolean {
  return defaultSidebarVisibility(
    "secondary",
    readStoredBoolean(SIDEBAR_STORAGE_KEYS.secondaryVisible),
  );
}

export function useSidebarManager() {
  const initialSidebarViewsRef = useRef<SidebarViewPair | null>(null);
  if (initialSidebarViewsRef.current === null) {
    initialSidebarViewsRef.current = readSidebarViews();
  }
  const initialSidebarViews = initialSidebarViewsRef.current;

  const initialSecondarySidebarVisibleRef = useRef<boolean | null>(null);
  if (initialSecondarySidebarVisibleRef.current === null) {
    initialSecondarySidebarVisibleRef.current = readSecondarySidebarVisible();
  }

  const sidebarRef = useRef<PanelImperativeHandle | null>(null);
  const secondarySidebarRef = useRef<PanelImperativeHandle | null>(null);
  const sidebarWidthRef = useRef(
    readStoredSidebarWidth(window.localStorage, "primary"),
  );
  const secondarySidebarWidthRef = useRef(
    readStoredSidebarWidth(window.localStorage, "secondary"),
  );
  const sidebarWidthWriteTimerRef = useRef(0);
  const secondarySidebarWidthWriteTimerRef = useRef(0);

  const [sidebarView, setSidebarViewState] = useState<PrimarySidebarViewId>(
    initialSidebarViews.primary,
  );
  const [secondarySidebarView, setSecondarySidebarViewState] =
    useState<SecondarySidebarViewId>(initialSidebarViews.secondary);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [secondarySidebarVisible, setSecondarySidebarVisible] = useState(
    initialSecondarySidebarVisibleRef.current,
  );

  const persistSidebarViews = useCallback((views: SidebarViewPair) => {
    setSidebarViewState(views.primary);
    setSecondarySidebarViewState(views.secondary);
    try {
      window.localStorage.setItem(
        SIDEBAR_STORAGE_KEYS.primaryView,
        views.primary,
      );
      window.localStorage.setItem(
        SIDEBAR_STORAGE_KEYS.secondaryView,
        views.secondary,
      );
    } catch {
      // storage may fail in private mode
    }
  }, []);

  const persistSecondarySidebarVisible = useCallback((visible: boolean) => {
    setSecondarySidebarVisible((current) =>
      current === visible ? current : visible,
    );
    try {
      window.localStorage.setItem(
        SIDEBAR_STORAGE_KEYS.secondaryVisible,
        String(visible),
      );
    } catch {
      // storage may fail in private mode
    }
  }, []);

  const setSidebarPanelVisible = useCallback(
    (slot: SidebarSlotId, visible: boolean) => {
      if (slot === "primary") {
        setSidebarVisible((current) =>
          current === visible ? current : visible,
        );
        return;
      }
      persistSecondarySidebarVisible(visible);
    },
    [persistSecondarySidebarVisible],
  );

  const persistSidebarView = useCallback(
    (view: PrimarySidebarViewId) => {
      persistSidebarViews(
        resolveSidebarViewSelection(
          { primary: sidebarView, secondary: secondarySidebarView },
          "primary",
          view,
        ),
      );
    },
    [persistSidebarViews, secondarySidebarView, sidebarView],
  );

  const persistSecondarySidebarView = useCallback(
    (view: SecondarySidebarViewId) => {
      persistSidebarViews(
        resolveSidebarViewSelection(
          { primary: sidebarView, secondary: secondarySidebarView },
          "secondary",
          view,
        ),
      );
    },
    [persistSidebarViews, secondarySidebarView, sidebarView],
  );

  const openSidebarPanel = useCallback(
    (slot: SidebarSlotId) => {
      const panel =
        slot === "primary" ? sidebarRef.current : secondarySidebarRef.current;
      const width =
        slot === "primary"
          ? sidebarWidthRef.current
          : secondarySidebarWidthRef.current;
      setSidebarPanelVisible(slot, true);
      if (panel?.isCollapsed()) panel.resize(width);
    },
    [setSidebarPanelVisible],
  );

  const openSecondarySidebarView = useCallback(
    (view: SecondarySidebarViewId) => {
      if (secondarySidebarView !== view) persistSecondarySidebarView(view);
      openSidebarPanel("secondary");
    },
    [openSidebarPanel, persistSecondarySidebarView, secondarySidebarView],
  );

  const closeSecondarySidebarPanel = useCallback(() => {
    secondarySidebarRef.current?.collapse();
    persistSecondarySidebarVisible(false);
  }, [persistSecondarySidebarVisible]);

  const toggleSidebar = useCallback(() => {
    const panel = sidebarRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) {
      openSidebarPanel("primary");
      return;
    }
    panel.collapse();
    setSidebarPanelVisible("primary", false);
  }, [openSidebarPanel, setSidebarPanelVisible]);

  const toggleSecondarySidebar = useCallback(() => {
    const panel = secondarySidebarRef.current;
    if (!panel) return;
    if (panel.isCollapsed() || !secondarySidebarVisible) {
      openSidebarPanel("secondary");
      return;
    }
    panel.collapse();
    persistSecondarySidebarVisible(false);
  }, [
    openSidebarPanel,
    persistSecondarySidebarVisible,
    secondarySidebarVisible,
  ]);

  const cycleSidebarView = useCallback(
    (view: PrimarySidebarViewId) => {
      const panel = sidebarRef.current;
      const collapsed = panel?.isCollapsed() ?? false;
      if (collapsed) {
        openSidebarPanel("primary");
        if (view !== sidebarView) persistSidebarView(view);
        return;
      }
      if (view === sidebarView) {
        panel?.collapse();
        setSidebarPanelVisible("primary", false);
        return;
      }
      persistSidebarView(view);
    },
    [openSidebarPanel, persistSidebarView, setSidebarPanelVisible, sidebarView],
  );

  const persistSidebarWidth = useCallback((next: number) => {
    sidebarWidthRef.current = next;
    if (sidebarWidthWriteTimerRef.current) {
      window.clearTimeout(sidebarWidthWriteTimerRef.current);
    }
    sidebarWidthWriteTimerRef.current = window.setTimeout(() => {
      sidebarWidthWriteTimerRef.current = 0;
      try {
        writeStoredSidebarWidth(window.localStorage, "primary", next);
      } catch {
        // ignore
      }
    }, 200);
  }, []);

  const persistSecondarySidebarWidth = useCallback((next: number) => {
    secondarySidebarWidthRef.current = next;
    if (secondarySidebarWidthWriteTimerRef.current) {
      window.clearTimeout(secondarySidebarWidthWriteTimerRef.current);
    }
    secondarySidebarWidthWriteTimerRef.current = window.setTimeout(() => {
      secondarySidebarWidthWriteTimerRef.current = 0;
      try {
        writeStoredSidebarWidth(window.localStorage, "secondary", next);
      } catch {
        // ignore
      }
    }, 200);
  }, []);

  const handleSidebarResize = useCallback(
    (slot: SidebarSlotId, sizeInPixels: number) => {
      const widthRef =
        slot === "primary" ? sidebarWidthRef : secondarySidebarWidthRef;
      const persistWidth =
        slot === "primary" ? persistSidebarWidth : persistSecondarySidebarWidth;
      const next = resolveSidebarResize({
        currentWidth: widthRef.current,
        sizeInPixels,
      });
      setSidebarPanelVisible(slot, next.visible);
      if (next.visible) persistWidth(next.width);
    },
    [persistSecondarySidebarWidth, persistSidebarWidth, setSidebarPanelVisible],
  );

  useEffect(() => {
    return () => {
      if (sidebarWidthWriteTimerRef.current) {
        window.clearTimeout(sidebarWidthWriteTimerRef.current);
      }
      if (secondarySidebarWidthWriteTimerRef.current) {
        window.clearTimeout(secondarySidebarWidthWriteTimerRef.current);
      }
    };
  }, []);

  return {
    closeSecondarySidebarPanel,
    cycleSidebarView,
    handleSidebarResize,
    openSecondarySidebarView,
    openSidebarPanel,
    persistSecondarySidebarView,
    persistSidebarView,
    secondarySidebarRef,
    secondarySidebarView,
    secondarySidebarVisible,
    secondarySidebarWidthRef,
    sidebarRef,
    sidebarView,
    sidebarVisible,
    sidebarWidthRef,
    toggleSecondarySidebar,
    toggleSidebar,
  };
}
