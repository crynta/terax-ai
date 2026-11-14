export type CsvPreview = {
  rows: string[][];
  columns: number;
  truncated: boolean;
};

const MAX_ROWS = 201;
const MAX_COLUMNS = 40;

/** Parse a bounded preview of an RFC 4180 style delimited text file. */
export function parseDelimitedPreview(
  input: string,
  delimiter: "," | ";" | "\t" = ",",
): CsvPreview {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let index = 0;
  let truncated = false;

  const finishCell = () => {
    if (row.length < MAX_COLUMNS) row.push(cell);
    else truncated = true;
    cell = "";
  };
  const finishRow = () => {
    finishCell();
    rows.push(row);
    row = [];
  };

  while (index < input.length) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 2;
        continue;
      }
      if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) {
      quoted = true;
    } else if (char === delimiter) {
      finishCell();
    } else if (char === "\n" || char === "\r") {
      finishRow();
      if (rows.length >= MAX_ROWS) {
        truncated = index < input.length - 1;
        break;
      }
      if (char === "\r" && input[index + 1] === "\n") index++;
    } else {
      cell += char;
    }
    index++;
  }

  if (rows.length < MAX_ROWS && (cell.length > 0 || row.length > 0))
    finishRow();
  if (rows[0]?.[0]?.startsWith("\uFEFF")) {
    rows[0][0] = rows[0][0].slice(1);
  }

  const columns = Math.min(
    MAX_COLUMNS,
    rows.reduce((max, current) => Math.max(max, current.length), 0),
  );
  return { rows, columns, truncated };
}

export function delimitedTextKind(
  path: string,
  content: string,
): "," | ";" | "\t" | null {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "tsv" || ext === "tab") return "\t";
  if (ext !== "csv") return null;

  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (quoted) {
      if (char === '"' && content[index + 1] === '"') index++;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "\n" || char === "\r") break;
    else if (char === ",") commas++;
    else if (char === ";") semicolons++;
  }
  return semicolons > commas ? ";" : ",";
}
