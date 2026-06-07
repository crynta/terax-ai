/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ArtifactHubPanel,
  ArtifactHubPanelView,
} from "@/modules/artifacts/ArtifactHubPanel";
import type {
  Artifact,
  ArtifactSummary,
  DeletedArtifactSummary,
} from "@/modules/artifacts/lib/types";

const artifactsNativeMock = vi.hoisted(() => ({
  deleteMany: vi.fn(),
  exportMany: vi.fn(),
  get: vi.fn(),
  listAll: vi.fn(),
  listDeleted: vi.fn(),
  purgeDeleted: vi.fn(),
  restoreDeleted: vi.fn(),
  restoreDeletedMany: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/modules/artifacts/lib/native", () => ({
  artifactsNative: artifactsNativeMock,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => vi.fn()),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

function artifact(overrides: Partial<ArtifactSummary>): ArtifactSummary {
  return {
    conversationId: "pi-1",
    slug: "hero",
    title: "Hero",
    kind: "html",
    version: 2,
    contentHash: "a".repeat(64),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    contentBytes: 18,
    ...overrides,
  };
}

const previewArtifact: Artifact = {
  summary: artifact({ title: "Landing Hero", slug: "hero" }),
  content: "<h1>Landing Hero</h1>",
};

const deletedArtifact: DeletedArtifactSummary = {
  conversationId: "pi-1",
  slug: "old-hero",
  title: "Old Hero",
  kind: "html",
  version: 3,
  contentHash: "b".repeat(64),
  deletedAt: "2026-01-02T00:00:00.000Z",
  contentBytes: 24,
  undoToken: "undo-1",
};

let container: HTMLDivElement;
let root: Root;

describe("ArtifactHubPanel", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    for (const mock of Object.values(artifactsNativeMock)) {
      mock.mockReset();
    }
    toastMock.error.mockReset();
    toastMock.success.mockReset();
    artifactsNativeMock.listAll.mockResolvedValue([]);
    artifactsNativeMock.listDeleted.mockResolvedValue([deletedArtifact]);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("renders a global searchable artifact hub", () => {
    const html = renderToStaticMarkup(
      <ArtifactHubPanelView
        sessions={[
          {
            conversationId: "pi-1",
            sessionTitle: "Marketing session",
            updatedAt: "2026-01-01T00:00:00.000Z",
            artifacts: [artifact({ title: "Landing Hero", slug: "hero" })],
          },
        ]}
        onOpenArtifact={() => {}}
      />,
    );

    expect(html).toContain(
      "Browse, search, and open artifacts across Pi sessions",
    );
    expect(html).toContain("Search artifacts");
    expect(html).toContain("All sessions");
    expect(html).toContain("Marketing session");
    expect(html).toContain("Landing Hero");
    expect(html).toContain("Open");
  });

  it("renders a metadata-only trash mode with restore and purge actions", () => {
    const html = renderToStaticMarkup(
      <ArtifactHubPanelView
        deletedArtifacts={[deletedArtifact]}
        initialMode="trash"
        sessions={[]}
        onOpenArtifact={() => {}}
        onPurgeDeletedArtifact={() => {}}
        onRestoreDeletedArtifact={() => {}}
      />,
    );

    expect(html).toContain("Trash");
    expect(html).toContain("Deleted artifacts");
    expect(html).toContain("Old Hero");
    expect(html).toContain("Restore selected");
    expect(html).toContain("Restore");
    expect(html).toContain("Delete forever");
    expect(html).toContain("undo-1");
    expect(html).not.toContain("<h1");
  });

  it("renders preview, metadata actions, and bulk controls", () => {
    const html = renderToStaticMarkup(
      <ArtifactHubPanelView
        sessions={[
          {
            conversationId: "pi-1",
            sessionTitle: "Marketing session",
            updatedAt: "2026-01-01T00:00:00.000Z",
            artifacts: [artifact({ title: "Landing Hero", slug: "hero" })],
          },
        ]}
        previewArtifact={previewArtifact}
        previewTarget={{ conversationId: "pi-1", slug: "hero" }}
        onCopyMetadata={() => {}}
        onOpenArtifact={() => {}}
        onPreviewArtifact={() => {}}
      />,
    );

    expect(html).toContain("Select visible");
    expect(html).toContain("Export selected");
    expect(html).toContain("Move to trash");
    expect(html).toContain("Preview");
    expect(html).toContain("Copy ref");
    expect(html).toContain("Preview selected artifact");
    expect(html).toContain("content hash");
    expect(html).toContain("Landing Hero");
  });

  it("clears stale selections when switching hub modes", async () => {
    await act(async () => {
      root.render(
        <ArtifactHubPanelView
          deletedArtifacts={[deletedArtifact]}
          sessions={[
            {
              conversationId: "pi-1",
              sessionTitle: "Marketing session",
              updatedAt: "2026-01-01T00:00:00.000Z",
              artifacts: [artifact({ title: "Landing Hero", slug: "hero" })],
            },
          ]}
          onOpenArtifact={() => {}}
        />,
      );
      await Promise.resolve();
    });

    await clickButton("Select visible");
    expect(document.body.textContent).toContain("1 selected");

    await clickButton("Trash");
    expect(document.body.textContent).toContain("No artifacts selected");

    await clickButton("Active");
    expect(document.body.textContent).toContain("No artifacts selected");
  });

  it("guards bulk delete against double invocation", async () => {
    let resolveDelete!: (value: {
      requestedCount: number;
      successCount: number;
      failureCount: number;
      items: unknown[];
    }) => void;
    artifactsNativeMock.listAll.mockResolvedValueOnce([
      {
        conversationId: "pi-1",
        artifactCount: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
        artifacts: [artifact({ title: "Landing Hero", slug: "hero" })],
      },
    ]);
    artifactsNativeMock.deleteMany.mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = resolve;
      }),
    );

    await act(async () => {
      root.render(<ArtifactHubPanel onOpenArtifact={() => {}} />);
      await Promise.resolve();
    });
    await waitFor(() => expect(document.body.textContent).toContain("Landing Hero"));
    await clickButton("Select visible");

    await clickButton("Move to trash");
    await clickButton("Move to trash");

    expect(artifactsNativeMock.deleteMany).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDelete({
        requestedCount: 1,
        successCount: 1,
        failureCount: 0,
        items: [],
      });
      await Promise.resolve();
    });
  });

  it("surfaces single-artifact purge failures", async () => {
    artifactsNativeMock.purgeDeleted.mockRejectedValueOnce(
      new Error("purge denied"),
    );

    await renderHubTrash();
    await clickButton("Delete forever");

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Artifact purge failed", {
        description: "purge denied",
      }),
    );
  });

  it("surfaces single-artifact restore failures", async () => {
    artifactsNativeMock.restoreDeleted.mockRejectedValueOnce(
      new Error("restore denied"),
    );

    await renderHubTrash();
    await clickButton("Restore");

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Artifact restore failed", {
        description: "restore denied",
      }),
    );
  });
});

async function renderHubTrash() {
  await act(async () => {
    root.render(<ArtifactHubPanel onOpenArtifact={() => {}} />);
    await Promise.resolve();
  });

  await waitFor(() => expect(document.body.textContent).toContain("Trash"));
  await clickButton("Trash");
  await waitFor(() => expect(document.body.textContent).toContain("Old Hero"));
}

async function clickButton(label: string) {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate) => (candidate.textContent ?? "").trim() === label,
  );
  if (!button) throw new Error(`Missing button ${label}`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < 30; i += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await Promise.resolve();
      });
    }
  }
  throw lastError;
}
