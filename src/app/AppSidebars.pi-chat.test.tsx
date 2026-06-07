import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AppSidebars } from "./AppSidebars";

const chatPanelProps: Array<Record<string, unknown>> = [];

vi.mock("@/modules/explorer", () => ({
  FileExplorer: () => <aside>Files</aside>,
}));
vi.mock("@/modules/inbox/components/InboxPanelLazy", () => ({
  InboxPanel: () => <aside>Inbox</aside>,
}));
vi.mock("@/modules/model-compare/ModelComparePanelLazy", () => ({
  ModelComparePanel: () => <aside>Compare</aside>,
}));
vi.mock("@/modules/pi/PiChatPanel", () => ({
  PiChatPanel: (props: Record<string, unknown>) => {
    chatPanelProps.push(props);
    return <aside>Chat</aside>;
  },
}));
vi.mock("@/modules/pi/PiPanel", () => ({
  PiPanel: () => <aside>Code</aside>,
}));
vi.mock("@/modules/source-control", () => ({
  SourceControlPanel: () => <aside>Git</aside>,
}));

import { AppSidebars as AppSidebarsComponent } from "./AppSidebars";

type AppSidebarsProps = Parameters<typeof AppSidebars>[0];

function props(): AppSidebarsProps {
  return {
    sidebarPosition: "left",
    workspace: <main>Workspace</main>,
    primary: {
      activeFilePath: null,
      activeView: "explorer",
      defaultSize: 260,
      explorerRef: { current: null },
      rootPath: "/repo",
      sourceControl: { changedCount: 0 } as AppSidebarsProps["primary"]["sourceControl"],
      visible: true,
      widthRef: { current: null },
      onAttachFileToAgent: () => {},
      onOpenFile: () => {},
      onOpenGitDiff: () => {},
      onOpenGitGraph: () => {},
      onOpenMarkdownPreview: () => {},
      onPathDeleted: () => {},
      onPathRenamed: () => {},
      onResize: () => {},
      onRevealInTerminal: () => {},
      onSelectView: () => {},
    },
    secondary: {
      activeView: "chat",
      chatContext: {
        workspaceRoot: "/repo",
        activeCwd: "/repo/packages/app",
        activeFile: "/repo/packages/app/src/App.tsx",
        activeTerminalPrivate: true,
      },
      chatFocusRequest: null,
      codeContext: {
        workspaceRoot: "/old-repo",
        activeCwd: "/old-repo/old-cwd",
        activeFile: "/old-repo/old.tsx",
        activeTerminalPrivate: false,
      },
      codeSurface: "sidebar",
      defaultSize: 320,
      inboxRows: [],
      piFocusRequest: null,
      unreadCounts: { chat: 0, code: 0, inbox: 0 },
      visible: true,
      widthRef: { current: null },
      onChatSelectedSessionChange: () => {},
      onClearReadInboxRows: () => {},
      onCodeSelectedSessionChange: () => {},
      onMarkInboxRowsRead: () => {},
      onOpenArtifactWorkspace: () => {},
      onOpenCodePopOut: () => {},
      onOpenCodeWorkspace: () => {},
      onOpenInboxRow: () => {},
      onOpenLocalAgent: () => {},
      onResize: () => {},
      onSelectView: () => {},
    },
  };
}

describe("AppSidebars Pi Chat context", () => {
  it("passes the active workspace context into the Chat panel", () => {
    chatPanelProps.length = 0;

    renderToStaticMarkup(<AppSidebarsComponent {...props()} />);

    expect(chatPanelProps[0]).toMatchObject({
      workspaceRoot: "/repo",
      activeCwd: "/repo/packages/app",
      activeFile: "/repo/packages/app/src/App.tsx",
      activeTerminalPrivate: true,
    });
  });
});
