import { defineComponentPreview } from "../../.forma/preview/config.ts";

export default defineComponentPreview({
  component: "./AppSidebars.preview.mocks.tsx",
  componentExport: "default",
  scenarios: [
    {
      id: "explorer-chat",
      name: "Explorer + Chat",
      args: {
        primaryView: "explorer",
        secondaryView: "chat",
        sidebarPosition: "left",
        workspaceLabel: "Editor workspace",
        resolvedTheme: "dark",
      },
      env: {
        pathname: "/preview/app-sidebars/explorer-chat",
        searchParams: {},
      },
    },
    {
      id: "source-control-code",
      name: "Source Control + Code",
      args: {
        primaryView: "source-control",
        secondaryView: "code",
        changedCount: 4,
        unreadCode: 2,
        workspaceLabel: "Diff review in progress",
        resolvedTheme: "dark",
      },
      env: {
        pathname: "/preview/app-sidebars/source-control-code",
        searchParams: {},
      },
    },
    {
      id: "compare-secondary",
      name: "Compare Panel",
      args: {
        primaryView: "explorer",
        secondaryView: "compare",
        workspaceLabel: "Model compare run",
        resolvedTheme: "dark",
      },
      env: {
        pathname: "/preview/app-sidebars/compare",
        searchParams: {},
      },
    },
    {
      id: "inbox-unread",
      name: "Inbox With Unread",
      args: {
        primaryView: "explorer",
        secondaryView: "inbox",
        inboxItemCount: 3,
        unreadChat: 1,
        unreadInbox: 2,
        workspaceLabel: "Notifications waiting",
        resolvedTheme: "dark",
      },
      env: {
        pathname: "/preview/app-sidebars/inbox",
        searchParams: {},
      },
    },
    {
      id: "code-floating-placeholder",
      name: "Code Open Elsewhere",
      args: {
        primaryView: "explorer",
        secondaryView: "code",
        codeSurface: "floating",
        unreadCode: 1,
        workspaceLabel: "Code chat is in a floating surface",
        resolvedTheme: "dark",
      },
      env: {
        pathname: "/preview/app-sidebars/code-floating",
        searchParams: {},
      },
    },
    {
      id: "right-rail",
      name: "Right Rail Layout",
      args: {
        primaryView: "explorer",
        secondaryView: "chat",
        sidebarPosition: "right",
        workspaceLabel: "Sidebars on the right edge",
        resolvedTheme: "light",
      },
      env: {
        pathname: "/preview/app-sidebars/right-rail",
        searchParams: {},
      },
    },
  ],
  controls: [
    {
      name: "primaryView",
      label: "Primary Sidebar",
      type: "select",
      options: [
        { label: "Explorer", value: "explorer" },
        { label: "Source Control", value: "source-control" },
      ],
      defaultValue: "explorer",
    },
    {
      name: "secondaryView",
      label: "Secondary Sidebar",
      type: "select",
      options: [
        { label: "Code", value: "code" },
        { label: "Chat", value: "chat" },
        { label: "Compare", value: "compare" },
        { label: "Inbox", value: "inbox" },
      ],
      defaultValue: "chat",
    },
    {
      name: "sidebarPosition",
      label: "Sidebar Position",
      type: "inline-radio",
      options: [
        { label: "Left", value: "left" },
        { label: "Right", value: "right" },
      ],
      defaultValue: "left",
    },
    {
      name: "codeSurface",
      label: "Code Surface",
      description: "Shows the placeholder when code is not in the sidebar.",
      type: "select",
      options: [
        { label: "Sidebar", value: "sidebar" },
        { label: "Floating", value: "floating" },
        { label: "Workspace", value: "workspace" },
      ],
      defaultValue: "sidebar",
    },
    {
      name: "changedCount",
      label: "Git Changes",
      type: "number",
      defaultValue: 0,
    },
    {
      name: "inboxItemCount",
      label: "Inbox Items",
      type: "number",
      defaultValue: 0,
    },
    {
      name: "unreadChat",
      label: "Unread Chat",
      type: "number",
      defaultValue: 0,
    },
    {
      name: "unreadCode",
      label: "Unread Code",
      type: "number",
      defaultValue: 0,
    },
    {
      name: "unreadInbox",
      label: "Unread Inbox",
      type: "number",
      defaultValue: 0,
    },
    {
      name: "workspaceLabel",
      label: "Workspace Label",
      type: "text",
      defaultValue: "Editor workspace",
    },
    {
      name: "resolvedTheme",
      label: "Theme",
      type: "inline-radio",
      options: [
        { label: "Dark", value: "dark" },
        { label: "Light", value: "light" },
      ],
      defaultValue: "dark",
    },
  ],
  moduleMocks: {
    "@/modules/explorer": "src/app/AppSidebars.preview.panels.tsx",
    "@/modules/inbox/components/InboxPanelLazy":
      "src/app/AppSidebars.preview.panels.tsx",
    "@/modules/model-compare/ModelComparePanelLazy":
      "src/app/AppSidebars.preview.panels.tsx",
    "@/modules/pi/PiChatPanel": "src/app/AppSidebars.preview.panels.tsx",
    "@/modules/pi/PiPanel": "src/app/AppSidebars.preview.panels.tsx",
    "@/modules/source-control": "src/app/AppSidebars.preview.panels.tsx",
    "@tauri-apps/api/core": "../../.forma/preview/shims/tauri-core.ts",
    "@tauri-apps/api/window": "../../.forma/preview/shims/tauri-window.ts",
    "@tauri-apps/api/webviewWindow":
      "../../.forma/preview/shims/tauri-webview-window.ts",
    "@tauri-apps/plugin-opener": "../../.forma/preview/shims/tauri-opener.ts",
  },
  envDefaults: {
    pathname: "/preview/app-sidebars",
    searchParams: {},
  },
});
