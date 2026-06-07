/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactPanel } from "@/modules/artifacts/components/ArtifactPanel";
import type {
  Artifact,
  ArtifactSummary,
  ArtifactVersionSummary,
} from "@/modules/artifacts/lib/types";

const summary: ArtifactSummary = {
  conversationId: "pi-1",
  slug: "hero",
  title: "Hero",
  kind: "html",
  version: 2,
  contentHash: "a".repeat(64),
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:01.000Z",
  contentBytes: 18,
};

const artifact: Artifact = {
  summary,
  content: "<h1>Hero</h1>",
};

const versions: ArtifactVersionSummary[] = [
  {
    version: 1,
    contentHash: "b".repeat(64),
    contentBytes: 14,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    version: 2,
    contentHash: "a".repeat(64),
    contentBytes: 18,
    createdAt: "2026-01-01T00:00:01.000Z",
  },
];

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(label),
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

describe("ArtifactPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });
  it("renders a helpful empty state", () => {
    const html = renderToStaticMarkup(
      <ArtifactPanel artifacts={[]} selectedArtifact={null} />,
    );

    expect(html).toContain("No artifacts yet");
    expect(html).toContain("Ask Pi to create an artifact");
  });

  it("renders artifact metadata and preview/code controls", () => {
    const html = renderToStaticMarkup(
      <ArtifactPanel artifacts={[summary]} selectedArtifact={artifact} />,
    );

    expect(html).toContain("Hero");
    expect(html).toContain("html");
    expect(html).toContain("v2");
    expect(html).toContain("Preview");
    expect(html).toContain("Code");
  });

  it("renders an export action for selected artifacts", () => {
    const html = renderToStaticMarkup(
      <ArtifactPanel
        artifacts={[summary]}
        selectedArtifact={artifact}
        onExportArtifact={() => {}}
      />,
    );

    expect(html).toContain("Export");
  });

  async function renderEditableArtifact(
    onSaveArtifact: (artifact: Artifact, content: string) => Promise<void>,
  ) {
    await act(async () => {
      root.render(
        <ArtifactPanel
          artifacts={[summary]}
          selectedArtifact={artifact}
          onSaveArtifact={onSaveArtifact}
        />,
      );
    });

    await act(async () => {
      findButton(container, "Edit").click();
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(textarea, "<h1>Updated Hero</h1>");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("shows rename and delete management actions for selected artifacts", async () => {
    const onRenameArtifact = vi.fn(async () => {});
    const onDeleteArtifact = vi.fn(async () => {});

    await act(async () => {
      root.render(
        <ArtifactPanel
          artifacts={[summary]}
          selectedArtifact={artifact}
          onDeleteArtifact={onDeleteArtifact}
          onRenameArtifact={onRenameArtifact}
        />,
      );
    });

    await act(async () => {
      findButton(container, "Rename").click();
    });
    const titleInput = container.querySelector(
      'input[aria-label="Artifact title"]',
    ) as HTMLInputElement;
    expect(titleInput).toBeTruthy();
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(titleInput, "Marketing Hero");
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      findButton(container, "Save title").click();
    });
    expect(onRenameArtifact).toHaveBeenCalledWith(artifact, "Marketing Hero");

    await act(async () => {
      findButton(container, "Delete").click();
    });
    expect(container.textContent).toContain("Delete this artifact?");
    await act(async () => {
      findButton(container, "Delete permanently").click();
    });
    expect(onDeleteArtifact).toHaveBeenCalledWith(artifact);
  });

  it("shows an explicit source edit flow for selected artifacts", async () => {
    const onSaveArtifact = vi.fn(async () => {});

    await renderEditableArtifact(onSaveArtifact);

    expect(container.textContent).toContain("Editing latest version");
    expect(
      container.querySelector("textarea")?.getAttribute("aria-label"),
    ).toBe("Artifact source");
    expect(findButton(container, "Save changes").disabled).toBe(false);
    await act(async () => {
      findButton(container, "Save changes").click();
    });

    expect(onSaveArtifact).toHaveBeenCalledWith(
      artifact,
      "<h1>Updated Hero</h1>",
    );
  });

  it("keeps the source editor open when saving fails", async () => {
    const onSaveArtifact = vi.fn(async () => {
      throw new Error("disk full");
    });

    await renderEditableArtifact(onSaveArtifact);
    await act(async () => {
      findButton(container, "Save changes").click();
    });

    expect(onSaveArtifact).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Editing latest version");
    expect(findButton(container, "Save changes").disabled).toBe(false);
  });

  it("renders version controls for the selected artifact", () => {
    const html = renderToStaticMarkup(
      <ArtifactPanel
        artifacts={[summary]}
        selectedArtifact={artifact}
        selectedVersion={1}
        versions={versions}
      />,
    );

    expect(html).toContain("Versions");
    expect(html).toContain("v1");
    expect(html).toContain("v2");
    expect(html).toContain("Viewing v1");
  });
});
