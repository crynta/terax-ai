import { describe, expect, it } from "vitest";
import {
  collectClipboardImageFiles,
  isAcceptedAttachmentFile,
} from "./composer";

describe("composer attachment helpers", () => {
  it("collects only usable image files from clipboard items", () => {
    const image = new File(["image"], "image.png", { type: "image/png" });
    const text = new File(["/tmp/image.png"], "image-path.txt", {
      type: "text/plain",
    });

    const items = [
      { kind: "string", type: "text/plain", getAsFile: () => null },
      { kind: "file", type: "text/plain", getAsFile: () => text },
      { kind: "file", type: "image/png", getAsFile: () => image },
      { kind: "file", type: "image/png", getAsFile: () => null },
    ] as unknown as DataTransferItem[];

    expect(collectClipboardImageFiles(items)).toEqual([image]);
  });

  it("accepts images and known text-like files while rejecting binary files", () => {
    expect(
      isAcceptedAttachmentFile({ name: "screenshot.png", type: "image/png" }),
    ).toBe(true);
    expect(isAcceptedAttachmentFile({ name: "notes.md", type: "" })).toBe(
      true,
    );
    expect(isAcceptedAttachmentFile({ name: "Dockerfile", type: "" })).toBe(
      true,
    );
    expect(
      isAcceptedAttachmentFile({ name: "archive.pdf", type: "application/pdf" }),
    ).toBe(false);
  });
});
