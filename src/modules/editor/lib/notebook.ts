export interface MultilineString extends Array<string> {}

export interface Output {
  output_type: "stream" | "display_data" | "execute_result" | "error";
  name?: "stdout" | "stderr";
  text?: string | string[];
  data?: {
    "text/plain"?: string | string[];
    "text/html"?: string | string[];
    "image/png"?: string;
    "image/jpeg"?: string;
    "application/json"?: any;
    [key: string]: any;
  };
  metadata?: Record<string, any>;
  execution_count?: number | null;
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

export interface Cell {
  cell_type: "markdown" | "code" | "raw";
  metadata: Record<string, any>;
  source: string | string[];
  execution_count?: number | null;
  outputs?: Output[];
}

export interface Notebook {
  cells: Cell[];
  metadata: Record<string, any>;
  nbformat: number;
  nbformat_minor: number;
}

export function parseNotebook(content: string): Notebook | null {
  if (!content.trim()) return null;
  try {
    const parsed = JSON.parse(content) as Notebook;
    if (!parsed || !Array.isArray(parsed.cells)) return null;
    return parsed;
  } catch (err) {
    console.error("Failed to parse notebook:", err);
    return null;
  }
}

export function serializeNotebook(notebook: Notebook): string {
  // nbformat conventionally uses 1 space indent, but we'll use 2 for readability
  // or stick to what the original file had (though we don't track it here).
  return JSON.stringify(notebook, null, 1) + "\n";
}

export function createEmptyNotebook(): Notebook {
  return {
    cells: [
      {
        cell_type: "code",
        execution_count: null,
        metadata: {},
        source: [""],
        outputs: [],
      },
    ],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  };
}
