/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ArtifactWorkspacePanel,
  ArtifactWorkspacePanelView,
} from "@/modules/artifacts/ArtifactWorkspacePanel";
import type {
  Artifact,
  ArtifactSummary,
  ArtifactVersionSummary,
} from "@/modules/artifacts/lib/types";

const artifactsNativeMock = vi.hoisted(() => ({
  get: vi.fn(),
  versions: vi.fn(),
}));

const artifactCollectionMock = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("@/modules/artifacts/lib/native", () => ({
  artifactsNative: artifactsNativeMock,
}));

vi.mock("@/modules/artifacts/hooks/useArtifactCollection", () => ({
  useArtifactCollection: () => ({
    artifacts: [summary],
    error: null,
    loading: false,
    refresh: artifactCollectionMock.refresh,
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const summary: ArtifactSummary = {
  conversationId: "pi-1",
  slug: "qa-react",
  title: "QA React",
  kind: "react",
  version: 1,
  contentHash: "a".repeat(64),
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  contentBytes: 127,
};

const artifact: Artifact = {
  summary,
  content:
    'export default function App() { return <h1 className="hero">QA React</h1>; }',
};

const versions: ArtifactVersionSummary[] = [
  {
    version: 1,
    contentHash: "a".repeat(64),
    contentBytes: 127,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

describe("ArtifactWorkspacePanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    artifactCollectionMock.refresh.mockReset();
    artifactsNativeMock.get.mockReset();
    artifactsNativeMock.versions.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("renders artifacts as a main workspace surface", () => {
    const html = renderToStaticMarkup(
      <ArtifactWorkspacePanelView
        artifacts={[summary]}
        selectedArtifact={artifact}
        selectedVersion={1}
        versions={versions}
      />,
    );

    expect(html).toContain("Artifacts");
    expect(html).toContain("QA React");
    expect(html).toContain("Preview");
    expect(html).toContain("Code");
    expect(html).toContain("h-full");
    expect(html).not.toContain("calc(100%-760px)");
  });

  it("keeps artifact load failures visible instead of collapsing to empty state", async () => {
    artifactsNativeMock.versions.mockRejectedValueOnce(
      new Error("versions down"),
    );
    artifactsNativeMock.get.mockRejectedValueOnce(new Error("artifact down"));

    await act(async () => {
      root.render(
        <ArtifactWorkspacePanel
          conversationId="pi-1"
          selectedSlug="qa-react"
        />,
      );
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(document.body.textContent).toContain(
        "Artifact versions failed to load: versions down",
      ),
    );
    expect(document.body.textContent).toContain(
      "Artifact failed to load: artifact down",
    );
    expect(document.body.textContent).toContain("QA React");
  });
});

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
