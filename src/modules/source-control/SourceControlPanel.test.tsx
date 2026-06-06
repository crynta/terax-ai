import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SourceControlPanel } from "./SourceControlPanel";
import type { SourceControlSummary } from "./useSourceControl";

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: () => "",
}));

vi.mock("./useSourceControlPanel", () => ({
  useSourceControlPanel: () => ({
    panelState: "ready",
    repo: {
      repoRoot: "/repo",
      branch: "main",
      upstream: null,
      isDetached: false,
    },
    status: {
      repoRoot: "/repo",
      branch: "main",
      upstream: null,
      ahead: 0,
      behind: 0,
      isDetached: false,
      truncated: false,
      changedFiles: [],
    },
    selected: null,
    commitMessage: "",
    actionBusy: null,
    statusError: null,
    actionError: null,
    remoteError: null,
    actionMessage: null,
    stagedEntries: [],
    unstagedEntries: [],
    fileEntries: [],
    headerCheckState: "unchecked",
    allClean: true,
    canPush: false,
    pushHint: null,
    canGenerateCommitMessage: false,
    generateCommitMessageHint: "Stage changes before generating a message",
    selectionTransition: "none",
    stagedEmptyText: "No staged changes",
    unstagedEmptyText: "No unstaged changes",
    pendingDiscard: null,
    setCommitMessage: vi.fn(),
    refresh: vi.fn(async () => {}),
    selectEntry: vi.fn(async () => {}),
    selectFile: vi.fn(async () => {}),
    stageEntry: vi.fn(async () => {}),
    unstageEntry: vi.fn(async () => {}),
    toggleStageFile: vi.fn(async () => {}),
    toggleAll: vi.fn(async () => {}),
    requestDiscardEntry: vi.fn(),
    requestDiscardFile: vi.fn(),
    requestDiscardAll: vi.fn(),
    confirmPendingDiscard: vi.fn(async () => {}),
    cancelPendingDiscard: vi.fn(),
    stageAllEntries: vi.fn(async () => {}),
    unstageAllEntries: vi.fn(async () => {}),
    generateCommitMessage: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    push: vi.fn(async () => {}),
  }),
}));

const sourceControl: SourceControlSummary = {
  repo: {
    repoRoot: "/repo",
    branch: "main",
    upstream: null,
    isDetached: false,
  },
  status: {
    repoRoot: "/repo",
    branch: "main",
    upstream: null,
    ahead: 0,
    behind: 0,
    isDetached: false,
    truncated: false,
    changedFiles: [],
  },
  changedCount: 0,
  upstream: null,
  ahead: 0,
  behind: 0,
  hasRepo: true,
  isLoading: false,
  localError: null,
  busyAction: null,
  lastRemoteError: null,
  applyStatus: vi.fn(),
  refresh: vi.fn(async () => {}),
  runRemoteAction: vi.fn(async () => ({ ok: true, action: null })),
};

describe("SourceControlPanel", () => {
  it("labels the sidebar and commit message field", () => {
    const html = renderToStaticMarkup(
      <SourceControlPanel
        open
        sourceControl={sourceControl}
        onOpenDiff={() => {}}
      />,
    );

    expect(html).toContain('aria-label="Source control"');
    expect(html).toContain('aria-label="Commit message"');
    expect(html).toContain('placeholder="Commit message…"');
  });
});
