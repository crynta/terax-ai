export type NotebookCellType = "markdown" | "code" | "raw";

export type NotebookOutput = {
  kind: "stream" | "result" | "display" | "error" | "unknown";
  text: string;
};

export type NotebookCell = {
  id: string;
  type: NotebookCellType;
  source: string;
  sourceFormat: "array" | "string";
  executionCount: number | null;
  outputs: NotebookOutput[];
};

export type NotebookDocument = {
  raw: NotebookRaw;
  cells: NotebookCell[];
  languageName: string | null;
};

export type ParseNotebookResult =
  | { ok: true; document: NotebookDocument }
  | { ok: false; message: string };

type JsonRecord = Record<string, unknown>;
type NotebookRawCell = JsonRecord & {
  cell_type?: unknown;
  source?: unknown;
  outputs?: unknown;
  execution_count?: unknown;
};
type NotebookRaw = JsonRecord & { cells: NotebookRawCell[] };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sourceToText(source: unknown): string {
  if (typeof source === "string") return source;
  if (Array.isArray(source)) return source.map((part) => String(part)).join("");
  return "";
}

function textToSource(
  text: string,
  format: NotebookCell["sourceFormat"],
): string | string[] {
  if (format === "string") return text;
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function normalizeCellType(value: unknown): NotebookCellType {
  if (value === "markdown" || value === "code" || value === "raw") return value;
  return "raw";
}

function outputText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => String(part)).join("");
  return "";
}

function dataText(data: unknown): string {
  if (!isRecord(data)) return "";
  const plain = data["text/plain"];
  const text = outputText(plain);
  if (text) return text;
  if (typeof data["image/png"] === "string") return "[image/png output]";
  if (typeof data["image/jpeg"] === "string") return "[image/jpeg output]";
  if (typeof data["text/html"] !== "undefined") return "[HTML output]";
  return "";
}

function normalizeOutputs(outputs: unknown): NotebookOutput[] {
  if (!Array.isArray(outputs)) return [];
  return outputs.map((output): NotebookOutput => {
    if (!isRecord(output)) return { kind: "unknown", text: "" };
    const outputType = output.output_type;
    if (outputType === "stream") {
      return { kind: "stream", text: outputText(output.text) };
    }
    if (outputType === "execute_result") {
      return { kind: "result", text: dataText(output.data) };
    }
    if (outputType === "display_data") {
      return { kind: "display", text: dataText(output.data) };
    }
    if (outputType === "error") {
      const traceback = outputText(output.traceback);
      const fallback = [output.ename, output.evalue]
        .filter(
          (part): part is string =>
            typeof part === "string" && part.length > 0,
        )
        .join(": ");
      return { kind: "error", text: traceback || fallback };
    }
    return { kind: "unknown", text: "" };
  });
}

function executionCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function languageName(raw: NotebookRaw): string | null {
  const metadata = raw.metadata;
  if (!isRecord(metadata)) return null;
  const languageInfo = metadata.language_info;
  if (isRecord(languageInfo) && typeof languageInfo.name === "string") {
    return languageInfo.name;
  }
  const kernelspec = metadata.kernelspec;
  if (isRecord(kernelspec) && typeof kernelspec.language === "string") {
    return kernelspec.language;
  }
  return null;
}

function normalizeNotebook(raw: NotebookRaw): NotebookDocument {
  return {
    raw,
    languageName: languageName(raw),
    cells: raw.cells.map((cell, index) => ({
      id: `cell-${index}`,
      type: normalizeCellType(cell.cell_type),
      source: sourceToText(cell.source),
      sourceFormat: Array.isArray(cell.source) ? "array" : "string",
      executionCount: executionCount(cell.execution_count),
      outputs: normalizeOutputs(cell.outputs),
    })),
  };
}

export function parseNotebookDocument(content: string): ParseNotebookResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      content.charCodeAt(0) === 0xfeff ? content.slice(1) : content,
    );
  } catch (error) {
    return {
      ok: false,
      message: `Invalid notebook JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (!isRecord(parsed)) {
    return { ok: false, message: "Notebook JSON root must be an object." };
  }
  if (!Array.isArray(parsed.cells)) {
    return { ok: false, message: "Notebook JSON must contain a cells array." };
  }

  const cells = parsed.cells.map((cell) =>
    isRecord(cell) ? ({ ...cell } as NotebookRawCell) : ({ source: "" } as NotebookRawCell),
  );
  return { ok: true, document: normalizeNotebook({ ...parsed, cells }) };
}

export function updateNotebookCellSource(
  document: NotebookDocument,
  cellId: string,
  source: string,
): NotebookDocument {
  const index = document.cells.findIndex((cell) => cell.id === cellId);
  if (index === -1) return document;
  const current = document.cells[index];
  const cells = document.raw.cells.map((cell, cellIndex) =>
    cellIndex === index
      ? { ...cell, source: textToSource(source, current.sourceFormat) }
      : cell,
  );
  return normalizeNotebook({ ...document.raw, cells });
}

export function serializeNotebookDocument(document: NotebookDocument): string {
  return `${JSON.stringify(document.raw, null, 2)}\n`;
}
