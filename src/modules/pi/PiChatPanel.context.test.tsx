import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const piPanelProps: Array<Record<string, unknown>> = [];

vi.mock("@/modules/artifacts/hooks/useArtifactCollection", () => ({
  useArtifactCollection: () => ({ artifacts: [] }),
}));

vi.mock("@/modules/pi/PiPanel", () => ({
  PiPanel: (props: Record<string, unknown>) => {
    piPanelProps.push(props);
    return <div data-testid="mock-pi-panel" />;
  },
}));

import { PiChatPanel } from "@/modules/pi/PiChatPanel";

describe("PiChatPanel context", () => {
  it("forwards workspace and active context to the embedded Pi panel", () => {
    piPanelProps.length = 0;
    const Panel = PiChatPanel as ComponentType<Record<string, unknown>>;

    renderToStaticMarkup(
      <Panel
        workspaceRoot="/repo"
        activeCwd="/repo/packages/app"
        activeFile="/repo/packages/app/src/App.tsx"
        activeTerminalPrivate
      />,
    );

    expect(piPanelProps[0]).toMatchObject({
      workspaceRoot: "/repo",
      activeCwd: "/repo/packages/app",
      activeFile: "/repo/packages/app/src/App.tsx",
      activeTerminalPrivate: true,
      surfaceLabel: "Chat",
    });
  });
});
