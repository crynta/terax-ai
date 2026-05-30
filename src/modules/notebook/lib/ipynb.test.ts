import { describe, expect, it } from "vitest";

import {
  parseNotebookDocument,
  serializeNotebookDocument,
  updateNotebookCellSource,
} from "./ipynb";

const sampleNotebook = {
  cells: [
    {
      cell_type: "markdown",
      metadata: {},
      source: ["# Title\n", "Body"],
    },
    {
      cell_type: "code",
      execution_count: 2,
      metadata: {},
      outputs: [{ output_type: "stream", name: "stdout", text: ["1\n"] }],
      source: "print(1)\n",
    },
    {
      cell_type: "raw",
      metadata: {},
      source: ["plain"],
    },
  ],
  metadata: { language_info: { name: "python" } },
  nbformat: 4,
  nbformat_minor: 5,
};

describe("parseNotebookDocument", () => {
  it("normalizes notebook cells into stable editable records", () => {
    const parsed = parseNotebookDocument(JSON.stringify(sampleNotebook));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.document.languageName).toBe("python");
    expect(parsed.document.cells).toMatchObject([
      { id: "cell-0", type: "markdown", source: "# Title\nBody" },
      {
        id: "cell-1",
        type: "code",
        source: "print(1)\n",
        executionCount: 2,
        outputs: [{ kind: "stream", text: "1\n" }],
      },
      { id: "cell-2", type: "raw", source: "plain" },
    ]);
  });

  it("reports invalid JSON as a parse failure", () => {
    const parsed = parseNotebookDocument("{not json");

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain("Invalid notebook JSON");
  });

  it("accepts notebooks that start with a UTF-8 BOM", () => {
    const parsed = parseNotebookDocument(`\uFEFF${JSON.stringify(sampleNotebook)}`);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document.cells[0]?.source).toBe("# Title\nBody");
  });
});

describe("serializeNotebookDocument", () => {
  it("updates only the requested cell and keeps original source shape", () => {
    const parsed = parseNotebookDocument(JSON.stringify(sampleNotebook));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const updated = updateNotebookCellSource(
      parsed.document,
      "cell-0",
      "# Updated\nSecond line\n",
    );
    const serialized = serializeNotebookDocument(updated);
    const json = JSON.parse(serialized);

    expect(json.cells[0].source).toEqual(["# Updated\n", "Second line\n"]);
    expect(json.cells[1].source).toBe("print(1)\n");
    expect(serialized.endsWith("\n")).toBe(true);
  });
});
