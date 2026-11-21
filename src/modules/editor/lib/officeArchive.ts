const MAX_OFFICE_ARCHIVE_ENTRIES = 4096;
const MAX_OFFICE_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_XLSX_WORKBOOK_XML_BYTES = 2 * 1024 * 1024;
const MAX_INFLATE_INPUT_CHUNK = 1024;
const MAX_STORED_INPUT_CHUNK = 32 * 1024;

export const MAX_OFFICE_PREVIEW_BYTES = 20 * 1024 * 1024;
export const MAX_XLSX_PREVIEW_SHEETS = 20;
export const MAX_XLSX_PREVIEW_CELLS = 200_000;

export type OfficeArchiveValidationOptions = {
  maxExpandedBytes?: number;
  maxSpreadsheetSheets?: number;
  maxSpreadsheetCells?: number;
  isCancelled?: () => boolean;
};

type ZipEntry = {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  expandedSize: number;
  dataOffset: number;
};

type WorksheetDimensions = {
  feed(chunk: Uint8Array): void;
  finish(): void;
  hasSheetData: boolean;
  cellCount(): number;
};

/**
 * Reject malformed or excessively expanded OOXML ZIP archives before parsing.
 * Declared sizes are checked first; compressed entries are then inflated in
 * small chunks so the limit also applies to the bytes actually produced.
 */
export async function validateOfficeArchive(
  bytes: ArrayBuffer,
  format: "DOCX" | "XLSX",
  options: OfficeArchiveValidationOptions = {},
): Promise<void> {
  const maxExpandedBytes =
    options.maxExpandedBytes ?? MAX_OFFICE_EXPANDED_BYTES;
  const maxSpreadsheetSheets =
    options.maxSpreadsheetSheets ?? MAX_XLSX_PREVIEW_SHEETS;
  const maxSpreadsheetCells =
    options.maxSpreadsheetCells ?? MAX_XLSX_PREVIEW_CELLS;
  const view = new DataView(bytes);
  const end = view.byteLength;
  const invalid = () => new Error(`The ${format} archive is invalid.`);
  const tooLarge = () =>
    new Error(`Expanded ${format} content is limited to 64 MB.`);
  const unsupported = () =>
    new Error(`This ${format} archive is unsupported or too large to preview.`);
  const firstPossibleEnd = Math.max(0, end - 22 - 0xffff);
  let endRecord = -1;
  for (let offset = end - 22; offset >= firstPossibleEnd; offset--) {
    if (offset < 0 || view.getUint32(offset, true) !== 0x06054b50) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === end) {
      endRecord = offset;
      break;
    }
  }
  if (endRecord < 0) throw invalid();

  const disk = view.getUint16(endRecord + 4, true);
  const centralDisk = view.getUint16(endRecord + 6, true);
  const entriesOnDisk = view.getUint16(endRecord + 8, true);
  const entryCount = view.getUint16(endRecord + 10, true);
  const centralSize = view.getUint32(endRecord + 12, true);
  const centralOffset = view.getUint32(endRecord + 16, true);
  const centralEnd = centralOffset + centralSize;
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    entryCount > MAX_OFFICE_ARCHIVE_ENTRIES ||
    centralEnd > endRecord
  ) {
    throw unsupported();
  }

  const entries: ZipEntry[] = [];
  let offset = centralOffset;
  let declaredExpandedBytes = 0;
  const archiveNames = new TextDecoder("utf-8", { fatal: true });
  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > centralEnd) throw invalid();
    if (view.getUint32(offset, true) !== 0x02014b50) throw invalid();

    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const expandedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const entryDisk = view.getUint16(offset + 34, true);
    const localOffset = view.getUint32(offset + 42, true);
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (
      nameLength === 0 ||
      entryEnd > centralEnd ||
      entryDisk !== 0 ||
      localOffset === 0xffffffff ||
      compressedSize === 0xffffffff ||
      expandedSize === 0xffffffff
    ) {
      throw unsupported();
    }
    if ((flags & 0x41) !== 0 || (method !== 0 && method !== 8)) {
      throw unsupported();
    }
    if (expandedSize > maxExpandedBytes) throw tooLarge();
    declaredExpandedBytes += expandedSize;
    if (declaredExpandedBytes > maxExpandedBytes) throw tooLarge();

    const nameBytes = new Uint8Array(bytes, offset + 46, nameLength);
    const name = (
      flags & 0x800 ? archiveNames : new TextDecoder("latin1")
    ).decode(nameBytes);
    const localHeaderEnd = localOffset + 30;
    if (
      localHeaderEnd > centralOffset ||
      view.getUint32(localOffset, true) !== 0x04034b50
    ) {
      throw invalid();
    }
    const localFlags = view.getUint16(localOffset + 6, true);
    const localMethod = view.getUint16(localOffset + 8, true);
    const localCompressedSize = view.getUint32(localOffset + 18, true);
    const localExpandedSize = view.getUint32(localOffset + 22, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localNameStart = localOffset + 30;
    const dataOffset = localNameStart + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    const usesDataDescriptor = (flags & 0x8) !== 0;
    if (
      localFlags !== flags ||
      localMethod !== method ||
      localNameLength !== nameLength ||
      dataOffset > centralOffset ||
      dataEnd > centralOffset ||
      dataEnd > endRecord ||
      localExpandedSize === 0xffffffff ||
      localCompressedSize === 0xffffffff ||
      !equalBytes(
        nameBytes,
        new Uint8Array(bytes, localNameStart, localNameLength),
      ) ||
      (!usesDataDescriptor &&
        (localCompressedSize !== compressedSize ||
          localExpandedSize !== expandedSize)) ||
      (method === 0 && compressedSize !== expandedSize)
    ) {
      throw invalid();
    }

    entries.push({
      name,
      flags,
      method,
      compressedSize,
      expandedSize,
      dataOffset,
    });
    offset = entryEnd;
  }
  if (offset > centralEnd) throw invalid();

  const { Inflate } = await import("fflate");
  if (options.isCancelled?.()) {
    throw new DOMException("Preview cancelled.", "AbortError");
  }
  const workbookDecoder = new TextDecoder();
  let workbookXml = "";
  let workbookXmlBytes = 0;
  let expandedBytes = 0;
  let worksheetCells = 0;
  let worksheetParts = 0;
  let lastYield = performance.now();
  const yieldIfNeeded = async () => {
    if (performance.now() - lastYield < 8) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (options.isCancelled?.())
      throw new DOMException("Preview cancelled.", "AbortError");
    lastYield = performance.now();
  };

  for (const entry of entries) {
    const lowerName = entry.name.toLowerCase();
    const isWorkbook = entry.name === "xl/workbook.xml";
    const isXml = lowerName.endsWith(".xml");
    const worksheet =
      format === "XLSX" &&
      isXml &&
      !lowerName.includes("/_rels/") &&
      !isWorkbook
        ? createWorksheetDimensions()
        : undefined;
    let entryExpandedBytes = 0;
    const consume = (chunk: Uint8Array) => {
      entryExpandedBytes += chunk.byteLength;
      expandedBytes += chunk.byteLength;
      if (
        entryExpandedBytes > maxExpandedBytes ||
        expandedBytes > maxExpandedBytes
      ) {
        throw tooLarge();
      }

      if (isWorkbook) {
        workbookXmlBytes += chunk.byteLength;
        if (workbookXmlBytes > MAX_XLSX_WORKBOOK_XML_BYTES) throw unsupported();
        workbookXml += workbookDecoder.decode(chunk, { stream: true });
      } else {
        worksheet?.feed(chunk);
      }
    };

    const compressed = new Uint8Array(
      bytes,
      entry.dataOffset,
      entry.compressedSize,
    );
    if (entry.method === 0) {
      for (
        let start = 0;
        start < compressed.length;
        start += MAX_STORED_INPUT_CHUNK
      ) {
        consume(compressed.subarray(start, start + MAX_STORED_INPUT_CHUNK));
        await yieldIfNeeded();
      }
    } else {
      const inflater = new Inflate((chunk) => consume(chunk));
      if (compressed.length === 0) {
        inflater.push(new Uint8Array(), true);
      } else {
        for (
          let start = 0;
          start < compressed.length;
          start += MAX_INFLATE_INPUT_CHUNK
        ) {
          const end = Math.min(
            start + MAX_INFLATE_INPUT_CHUNK,
            compressed.length,
          );
          inflater.push(
            compressed.subarray(start, end),
            end === compressed.length,
          );
          await yieldIfNeeded();
        }
      }
    }

    if (entryExpandedBytes !== entry.expandedSize) throw invalid();
    if (isWorkbook) workbookXml += workbookDecoder.decode();
    if (worksheet) {
      worksheet.finish();
      if (lowerName.includes("/worksheets/") || worksheet.hasSheetData) {
        worksheetParts++;
        worksheetCells += worksheet.cellCount();
        if (
          worksheetParts > maxSpreadsheetSheets ||
          worksheetCells > maxSpreadsheetCells
        ) {
          throw new Error(
            `XLSX preview is limited to ${maxSpreadsheetCells.toLocaleString()} cells across ${maxSpreadsheetSheets} worksheets.`,
          );
        }
      }
    }
  }

  if (format === "XLSX") {
    const sheetTags = workbookXml.match(
      /<(?:[\w.-]+:)?sheet(?=[\s/>])[^>]*>/gi,
    );
    if ((sheetTags?.length ?? 0) > maxSpreadsheetSheets) {
      throw new Error(
        `XLSX preview is limited to ${maxSpreadsheetSheets} worksheets.`,
      );
    }
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function createWorksheetDimensions(): WorksheetDimensions {
  let carry = "";
  let maxRow = 0;
  let maxColumn = 0;
  let hasSheetData = false;
  const decoder = new TextDecoder();

  const observeCell = (column: string, row: string) => {
    const rowNumber = Number(row);
    let columnNumber = 0;
    for (const letter of column.toUpperCase()) {
      columnNumber = columnNumber * 26 + letter.charCodeAt(0) - 64;
    }
    if (
      !Number.isSafeInteger(rowNumber) ||
      rowNumber > 1_048_576 ||
      columnNumber > 16_384
    ) {
      throw new Error("XLSX cell reference is outside Excel worksheet bounds.");
    }
    maxRow = Math.max(maxRow, rowNumber);
    maxColumn = Math.max(maxColumn, columnNumber);
  };

  let cellElements = 0;
  const scan = (text: string) => {
    const input = carry + text;
    const tags =
      /<(?:[\w.-]+:)?(sheetData|c|row|dimension)(?=[\s/>])([^<>]*)>/gi;
    for (const match of input.matchAll(tags)) {
      const kind = match[1].toLowerCase();
      const attributes = match[2];
      if (kind === "sheetdata") hasSheetData = true;
      if (kind === "c") {
        cellElements++;
        const ref = /(?:^|\s)r\s*=\s*["']([A-Z]+)([1-9]\d*)["']/i.exec(
          attributes,
        );
        if (ref) observeCell(ref[1], ref[2]);
      } else if (kind === "row") {
        const ref = /(?:^|\s)r\s*=\s*["']([1-9]\d*)["']/i.exec(attributes);
        if (ref) {
          const rowNumber = Number(ref[1]);
          if (!Number.isSafeInteger(rowNumber) || rowNumber > 1_048_576) {
            throw new Error(
              "XLSX row reference is outside Excel worksheet bounds.",
            );
          }
          maxRow = Math.max(maxRow, rowNumber);
        }
      } else if (kind === "dimension") {
        const ref =
          /(?:^|\s)ref\s*=\s*["']([A-Z]+)([1-9]\d*)(?::([A-Z]+)([1-9]\d*))?["']/i.exec(
            attributes,
          );
        if (ref) {
          observeCell(ref[1], ref[2]);
          if (ref[3] && ref[4]) observeCell(ref[3], ref[4]);
        }
      }
    }
    const lastOpen = input.lastIndexOf("<");
    const lastClose = input.lastIndexOf(">");
    carry = lastOpen > lastClose ? input.slice(lastOpen) : "";
    if (carry.length > 64 * 1024)
      throw new Error("XLSX XML tag is too large to preview.");
  };

  return {
    feed: (chunk) => scan(decoder.decode(chunk, { stream: true })),
    finish: () => scan(decoder.decode()),
    get hasSheetData() {
      return hasSheetData;
    },
    cellCount: () => Math.max(cellElements, maxRow * maxColumn),
  };
}
