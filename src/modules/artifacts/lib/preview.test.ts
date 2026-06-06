import { describe, expect, it, vi } from "vitest";
import {
  buildArtifactPreviewDocument,
  createArtifactBlobUrl,
  isPreviewableArtifactKind,
} from "@/modules/artifacts/lib/preview";

describe("artifact preview documents", () => {
  it("wraps HTML artifacts with a strict CSP and error bridge", () => {
    const document = buildArtifactPreviewDocument({
      kind: "html",
      content: "<main><h1>Hello</h1></main>",
      token: "preview-token",
    });

    expect(document).toContain("default-src 'none'");
    expect(document).toContain("script-src 'unsafe-inline'");
    expect(document).toContain("connect-src 'none'");
    expect(document).toContain("form-action 'none'");
    expect(document).toContain("preview-token");
    expect(document).toContain("<main><h1>Hello</h1></main>");
  });

  it("escapes markdown and text previews instead of injecting raw HTML", () => {
    const document = buildArtifactPreviewDocument({
      kind: "markdown",
      content: "# Title\n<script>alert(1)</script>",
      token: "preview-token",
    });

    expect(document).toContain("Title");
    expect(document).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(document).not.toContain("<script>alert(1)</script>");
  });

  it("treats React artifacts as previewable through the compiler path", () => {
    expect(isPreviewableArtifactKind("react")).toBe(true);
  });

  it("creates revocable blob urls through the provided URL implementation", () => {
    const url = {
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    };

    const blobUrl = createArtifactBlobUrl("<p>Hi</p>", url);
    blobUrl.revoke();

    expect(blobUrl.href).toBe("blob:test");
    expect(url.createObjectURL).toHaveBeenCalledOnce();
    expect(url.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});
