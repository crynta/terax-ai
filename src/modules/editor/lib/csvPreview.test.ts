import { describe, expect, it } from "vitest";
import { parseDelimitedPreview } from "./csvPreview";

describe("parseDelimitedPreview", () => {
  it("removes a leading BOM before parsing quoted headers", () => {
    const preview = parseDelimitedPreview(
      '\uFEFF"Last, First",Age\n"Doe, Jane",30',
    );

    expect(preview).toEqual({
      rows: [
        ["Last, First", "Age"],
        ["Doe, Jane", "30"],
      ],
      columns: 2,
      truncated: false,
    });
  });
});
