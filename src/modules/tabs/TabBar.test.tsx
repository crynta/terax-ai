/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tab } from "./lib/useTabs";
import { TabBar } from "./TabBar";

const tabs: Tab[] = [
  {
    activeLeafId: 2,
    id: 1,
    kind: "terminal",
    paneTree: { kind: "leaf", id: 2 },
    title: "shell",
  },
];

const noop = vi.fn();

function renderTabBar() {
  return (
    <TabBar
      activeId={1}
      tabs={tabs}
      onClose={noop}
      onNew={noop}
      onNewArtifacts={noop}
      onNewEditor={noop}
      onNewGitGraph={noop}
      onNewPreview={noop}
      onNewPrivate={noop}
      onNewWorkflow={noop}
      onPin={noop}
      onRename={noop}
      onSelect={noop}
    />
  );
}

describe("TabBar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("offers Artifacts and Canvas from the new-tab menu", async () => {
    await act(async () => {
      root.render(renderTabBar());
    });

    const newTabButton = container.querySelector<HTMLButtonElement>(
      'button[title="New tab"]',
    );
    expect(newTabButton).toBeTruthy();

    await act(async () => {
      newTabButton?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
      newTabButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, button: 0 }),
      );
    });

    expect(document.body.textContent).toContain("Artifacts");
    expect(document.body.textContent).toContain("Canvas");
    expect(document.body.textContent).not.toContain("Workflow Canvas");
  });
});
