/**
 * @vitest-environment jsdom
 */
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PreviewWrapper from "../../.forma/preview/wrapper";
import AppSidebarsPreview from "./AppSidebars.preview.mocks";

vi.mock("@/modules/explorer", () => import("./AppSidebars.preview.panels"));
vi.mock("@/modules/inbox/components/InboxPanelLazy", () =>
  import("./AppSidebars.preview.panels"),
);
vi.mock("@/modules/model-compare/ModelComparePanelLazy", () =>
  import("./AppSidebars.preview.panels"),
);
vi.mock("@/modules/pi/PiChatPanel", () => import("./AppSidebars.preview.panels"));
vi.mock("@/modules/pi/PiPanel", () => import("./AppSidebars.preview.panels"));
vi.mock("@/modules/source-control", () => import("./AppSidebars.preview.panels"));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("AppSidebars preview runtime", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: ResizeObserverStub,
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: ResizeObserverStub,
    });
    container = document.createElement("div");
    container.style.height = "720px";
    container.style.width = "1280px";
    document.body.append(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
    root = null;
    Reflect.deleteProperty(window, "ResizeObserver");
    Reflect.deleteProperty(globalThis, "ResizeObserver");
  });

  it("renders production AppSidebars without Tauri metadata errors", () => {
    act(() => {
      root = createRoot(container);
      root.render(
        <PreviewWrapper previewArgs={{ resolvedTheme: "dark" }}>
          <div className="flex h-[720px] min-h-0 w-full">
            <AppSidebarsPreview />
          </div>
        </PreviewWrapper>,
      );
    });

    expect(container.textContent).toContain("Editor workspace");
    expect(container.textContent).toContain("File Explorer");
    expect(container.querySelector('[data-slot="resizable-panel-group"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="resizable-handle"]')).not.toBeNull();
  });
});
