import { clampSidebarWidth } from "./persistence";

type ResolveSidebarResizeInput = {
  currentWidth: number;
  sizeInPixels: number;
};

type SidebarResizeState = {
  visible: boolean;
  width: number;
};

export function resolveSidebarResize({
  currentWidth,
  sizeInPixels,
}: ResolveSidebarResizeInput): SidebarResizeState {
  if (sizeInPixels <= 0) {
    return {
      visible: false,
      width: currentWidth,
    };
  }

  return {
    visible: true,
    width: clampSidebarWidth(sizeInPixels),
  };
}
