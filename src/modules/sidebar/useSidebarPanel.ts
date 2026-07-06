import { animationScale } from "@/lib/useAnimationScale";
import {
  readSidebarDisabledFastPath,
  readSidebarStartCollapsedFastPath,
} from "@/modules/settings/preferences";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import type { SidebarViewId } from "./types";

export const SIDEBAR_DEFAULT_WIDTH = 260;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_WIDTH_STORAGE_KEY = "terax.sidebar.width";
const SIDEBAR_VIEW_STORAGE_KEY = "terax.sidebar.view";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "terax.sidebar.collapsed";

function clampSidebarWidth(width: number): number {
  return Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)),
  );
}

function readSidebarWidth(): number {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed)
      ? clampSidebarWidth(parsed)
      : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function readSidebarView(): SidebarViewId {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_VIEW_STORAGE_KEY);
    if (stored === "explorer" || stored === "source-control") return stored;
  } catch {
    // ignore
  }
  return "explorer";
}

function readSidebarCollapsed(): boolean {
  // A disabled sidebar starts closed; "start hidden" wins over last state.
  if (readSidebarDisabledFastPath()) return true;
  if (readSidebarStartCollapsedFastPath()) return true;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

type FocusableExplorer = {
  focus: () => void;
  isFocused: () => boolean;
};

const SIDEBAR_ANIM_MS = 250;
let sidebarAnimTimer = 0;
// While the open/close transition runs, ResizeObserver reports every
// intermediate width — persisting those would clobber the restored width
// (e.g. store 2px right before a collapse hits 0).
let sidebarAnimating = false;

/** Animate programmatic open/close only — drags must stay transition-free.
 *  react-resizable-panels sizes panels via flex-grow once the layout store
 *  is live (flex-basis only before first layout), so transition both. */
function animateSidebarPanel(run: () => void): void {
  // Both panels: flex-grow ratios change together — animating only one
  // makes the proportions jump at the start of the transition.
  const els = [
    document.getElementById("sidebar"),
    document.getElementById("workspace"),
  ].filter((el): el is HTMLElement => el instanceof HTMLElement);
  const ms = Math.round(SIDEBAR_ANIM_MS * animationScale());
  if (els.length > 0 && ms > 0) {
    if (sidebarAnimTimer) window.clearTimeout(sidebarAnimTimer);
    sidebarAnimating = true;
    for (const el of els) {
      el.style.transition = `flex-grow ${ms}ms ease-out, flex-basis ${ms}ms ease-out`;
    }
    sidebarAnimTimer = window.setTimeout(() => {
      sidebarAnimTimer = 0;
      sidebarAnimating = false;
      for (const el of els) el.style.transition = "";
    }, ms + 50);
  }
  run();
}

export function useSidebarPanel(
  explorerRef: RefObject<FocusableExplorer | null>,
) {
  const sidebarRef = useRef<PanelImperativeHandle | null>(null);
  const sidebarWidthRef = useRef(readSidebarWidth());
  const sidebarWidthWriteTimerRef = useRef(0);
  const explorerReturnFocusRef = useRef<HTMLElement | null>(null);
  const [sidebarView, setSidebarViewState] =
    useState<SidebarViewId>(readSidebarView);
  const [initialSidebarCollapsed] = useState(readSidebarCollapsed);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    initialSidebarCollapsed,
  );
  const collapsedRef = useRef(initialSidebarCollapsed);

  const persistSidebarView = useCallback((view: SidebarViewId) => {
    setSidebarViewState(view);
    try {
      window.localStorage.setItem(SIDEBAR_VIEW_STORAGE_KEY, view);
    } catch {
      // storage may fail in private mode
    }
  }, []);

  const persistSidebarCollapsed = useCallback((collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    if (collapsedRef.current === collapsed) return;
    collapsedRef.current = collapsed;
    try {
      window.localStorage.setItem(
        SIDEBAR_COLLAPSED_STORAGE_KEY,
        collapsed ? "1" : "0",
      );
    } catch {
      // storage may fail in private mode
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    const p = sidebarRef.current;
    if (!p) return;
    animateSidebarPanel(() => {
      if (p.getSize().asPercentage <= 0)
        p.resize(`${sidebarWidthRef.current}px`);
      else p.collapse();
    });
  }, []);

  /** Animated explicit open/close — used by shell-tool overrides. */
  const setSidebarOpen = useCallback((open: boolean) => {
    const p = sidebarRef.current;
    if (!p) return;
    const isOpen = p.getSize().asPercentage > 0;
    if (open === isOpen) return;
    animateSidebarPanel(() => {
      if (open) p.resize(`${sidebarWidthRef.current}px`);
      else p.collapse();
    });
  }, []);

  const cycleSidebarView = useCallback(
    (view: SidebarViewId) => {
      const panel = sidebarRef.current;
      const collapsed = panel ? panel.getSize().asPercentage <= 0 : false;
      if (collapsed) {
        if (panel)
          animateSidebarPanel(() =>
            panel.resize(`${sidebarWidthRef.current}px`),
          );
        if (view !== sidebarView) persistSidebarView(view);
        return;
      }
      if (view === sidebarView) {
        if (panel) animateSidebarPanel(() => panel.collapse());
        return;
      }
      persistSidebarView(view);
    },
    [persistSidebarView, sidebarView],
  );

  const persistSidebarWidth = useCallback((raw: number) => {
    if (sidebarAnimating) return;
    // Clamp before storing: a stray intermediate width (animation frame,
    // HMR mid-transition) must never become the width the sidebar reopens
    // to — programmatic resize() bypasses the panel's min size.
    const next = clampSidebarWidth(raw);
    sidebarWidthRef.current = next;
    if (sidebarWidthWriteTimerRef.current) {
      window.clearTimeout(sidebarWidthWriteTimerRef.current);
    }
    sidebarWidthWriteTimerRef.current = window.setTimeout(() => {
      sidebarWidthWriteTimerRef.current = 0;
      try {
        window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
    }, 200);
  }, []);

  useEffect(() => {
    return () => {
      if (sidebarWidthWriteTimerRef.current) {
        window.clearTimeout(sidebarWidthWriteTimerRef.current);
      }
    };
  }, []);

  const toggleExplorerFocus = useCallback(() => {
    const explorer = explorerRef.current;
    const panel = sidebarRef.current;
    const collapsed = panel ? panel.getSize().asPercentage <= 0 : false;
    if (sidebarView !== "explorer" || collapsed) {
      if (panel && collapsed)
        animateSidebarPanel(() => panel.resize(`${sidebarWidthRef.current}px`));
      if (sidebarView !== "explorer") persistSidebarView("explorer");
      const active = document.activeElement;
      explorerReturnFocusRef.current =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
      requestAnimationFrame(() => explorerRef.current?.focus());
      return;
    }
    if (!explorer) return;
    if (explorer.isFocused()) {
      const target = explorerReturnFocusRef.current;
      explorerReturnFocusRef.current = null;
      if (target && document.body.contains(target)) {
        target.focus();
      } else {
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
      return;
    }
    const active = document.activeElement;
    explorerReturnFocusRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
    explorer.focus();
  }, [explorerRef, persistSidebarView, sidebarView]);

  return {
    sidebarRef,
    sidebarWidthRef,
    sidebarView,
    initialSidebarCollapsed,
    sidebarCollapsed,
    persistSidebarView,
    persistSidebarCollapsed,
    toggleSidebar,
    setSidebarOpen,
    cycleSidebarView,
    persistSidebarWidth,
    toggleExplorerFocus,
  };
}
