import { describe, expect, it } from "vitest";
import { artifactPreviewRuntimeError } from "@/modules/artifacts/lib/previewMessages";

describe("artifact preview runtime messages", () => {
  it("accepts matching preview error messages", () => {
    expect(
      artifactPreviewRuntimeError(
        {
          source: "terax-artifact-preview",
          token: "preview-token",
          type: "error",
          message: "Boom",
        },
        "preview-token",
      ),
    ).toBe("Boom");
  });

  it("ignores messages from other previews or sources", () => {
    expect(
      artifactPreviewRuntimeError(
        {
          source: "terax-artifact-preview",
          token: "other-token",
          type: "error",
          message: "Boom",
        },
        "preview-token",
      ),
    ).toBeNull();
    expect(
      artifactPreviewRuntimeError(
        { source: "elsewhere", token: "preview-token", type: "error" },
        "preview-token",
      ),
    ).toBeNull();
  });
});
