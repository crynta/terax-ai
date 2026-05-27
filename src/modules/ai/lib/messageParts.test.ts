import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { normalizeDataUrlFileParts } from "./messageParts";

describe("normalizeDataUrlFileParts", () => {
  it("converts base64 data-url file parts before model prompting", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "can you see this?" },
          {
            type: "file",
            data: "data:image/png;base64,aGVsbG8=",
            mediaType: "application/octet-stream",
            filename: "screenshot.png",
          },
        ],
      },
    ];

    const normalized = normalizeDataUrlFileParts(messages);
    const filePart = (normalized[0].content as unknown[])[1] as {
      data: string;
      mediaType: string;
    };

    expect(filePart.data).toBe("aGVsbG8=");
    expect(filePart.mediaType).toBe("image/png");
  });

  it("leaves hosted file urls untouched", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "file",
            data: "https://example.com/screenshot.png",
            mediaType: "image/png",
          },
        ],
      },
    ];

    expect(normalizeDataUrlFileParts(messages)).toEqual(messages);
  });
});
