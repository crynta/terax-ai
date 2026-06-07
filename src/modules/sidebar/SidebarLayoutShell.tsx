import type { ReactNode, RefObject } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import {
  oppositeSidebarPosition,
  orderSidebarLayout,
  type SidebarSlotId,
} from "./layout";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "./persistence";
import type { SidebarPosition } from "./position";
import { SidebarRail } from "./SidebarRail";
import type {
  PrimarySidebarViewId,
  SecondarySidebarViewId,
  SidebarViewItem,
} from "./types";

type ResizePayload = number | { inPixels: number };

type SidebarPanelConfig<
  T extends PrimarySidebarViewId | SecondarySidebarViewId,
> = {
  activeView: T;
  badges?: Partial<Record<T, number>>;
  defaultSize: number;
  items: readonly SidebarViewItem<T>[];
  panelRef: RefObject<PanelImperativeHandle | null>;
  renderContent: () => ReactNode;
  visible: boolean;
  onResize: (sizeInPixels: number) => void;
  onSelectView: (view: T) => void;
};

type Props = {
  primary: SidebarPanelConfig<PrimarySidebarViewId>;
  secondary: SidebarPanelConfig<SecondarySidebarViewId>;
  sidebarPosition: SidebarPosition;
  workspace: ReactNode;
};

function resizePayloadToPixels(size: ResizePayload): number {
  return typeof size === "number" ? size : size.inPixels;
}

export function SidebarLayoutShell({
  primary,
  secondary,
  sidebarPosition,
  workspace,
}: Props) {
  const renderSidebarPanel = (slot: SidebarSlotId) => {
    const primarySlot = slot === "primary";
    const position = primarySlot
      ? sidebarPosition
      : oppositeSidebarPosition(sidebarPosition);
    const config = primarySlot ? primary : secondary;

    return (
      <ResizablePanel
        key={primarySlot ? "sidebar" : "secondary-sidebar"}
        id={primarySlot ? "sidebar" : "secondary-sidebar"}
        panelRef={config.panelRef}
        defaultSize={config.visible ? config.defaultSize : 0}
        minSize={SIDEBAR_MIN_WIDTH}
        maxSize={SIDEBAR_MAX_WIDTH}
        collapsible
        collapsedSize={0}
        onResize={(size) => config.onResize(resizePayloadToPixels(size))}
      >
        <div
          className={cn(
            "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card",
            position === "right"
              ? "border-l border-border/60"
              : "border-r border-border/60",
          )}
        >
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {config.renderContent()}
          </div>
          <nav
            className="shrink-0"
            aria-label={
              primarySlot ? "Primary sidebar views" : "Secondary sidebar views"
            }
          >
            {primarySlot ? (
              <SidebarRail
                activeView={primary.activeView}
                badges={primary.badges}
                items={primary.items}
                onSelectView={primary.onSelectView}
              />
            ) : (
              <SidebarRail
                activeView={secondary.activeView}
                badges={secondary.badges}
                items={secondary.items}
                onSelectView={secondary.onSelectView}
              />
            )}
          </nav>
        </div>
      </ResizablePanel>
    );
  };

  const workspacePanel = (
    <ResizablePanel
      key="workspace"
      id="workspace"
      defaultSize="78%"
      minSize="30%"
    >
      {workspace}
    </ResizablePanel>
  );

  const panels = {
    "primary-sidebar": renderSidebarPanel("primary"),
    workspace: workspacePanel,
    "secondary-sidebar": renderSidebarPanel("secondary"),
  };

  return (
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
      {orderSidebarLayout(sidebarPosition).flatMap((slot, index) =>
        index === 0
          ? [panels[slot]]
          : [
              <ResizableHandle key={`handle-${slot}`} withHandle />,
              panels[slot],
            ],
      )}
    </ResizablePanelGroup>
  );
}
