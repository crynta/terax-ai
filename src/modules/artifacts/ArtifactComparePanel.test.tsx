/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactComparePanel } from "@/modules/artifacts/ArtifactComparePanel";

const artifactsNativeMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("@/modules/artifacts/lib/native", () => ({
  artifactsNative: artifactsNativeMock,
}));

let container: HTMLDivElement;
let root: Root;

describe("ArtifactComparePanel", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    artifactsNativeMock.get.mockReset();
    artifactsNativeMock.get.mockResolvedValue({
      summary: {
        conversationId: "pi-1",
        slug: "hero",
        title: "Hero",
        kind: "html",
        version: 1,
        contentHash: "a".repeat(64),
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        contentBytes: 13,
      },
      content: "<h1>Hero</h1>",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("loads the artifact and renders a browser route side-by-side", async () => {
    await act(async () => {
      root.render(
        <ArtifactComparePanel
          conversationId="pi-1"
          slug="hero"
          url="http://localhost:5173/hero"
          onOpenArtifact={() => {}}
          onUrlChange={() => {}}
        />,
      );
      await Promise.resolve();
    });

    expect(artifactsNativeMock.get).toHaveBeenCalledWith("pi-1", "hero");
    expect(document.body.textContent).toContain(
      "Compare artifact to browser route",
    );
    expect(document.body.textContent).toContain("Artifact preview");
    expect(document.body.textContent).toContain("Browser route");
    expect(document.querySelectorAll("iframe").length).toBeGreaterThanOrEqual(
      2,
    );
  });
});
