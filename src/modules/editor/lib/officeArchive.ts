const MAX_OFFICE_ARCHIVE_ENTRIES = 4096;
const MAX_OFFICE_EXPANDED_BYTES = 64 * 1024 * 1024;

export const MAX_OFFICE_PREVIEW_BYTES = 20 * 1024 * 1024;

/** Reject malformed or excessively expanded OOXML ZIP archives before parsing. */
export function validateOfficeArchive(
  bytes: ArrayBuffer,
  format: "DOCX" | "XLSX",
): void {
  const view = new DataView(bytes);
  const end = view.byteLength;
  const invalid = () => new Error(`The ${format} archive is invalid.`);
  const firstPossibleEnd = Math.max(0, end - 22 - 0xffff);
  let endRecord = -1;
  for (let offset = end - 22; offset >= firstPossibleEnd; offset--) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
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
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    entryCount > MAX_OFFICE_ARCHIVE_ENTRIES ||
    centralOffset + centralSize > endRecord
  ) {
    throw new Error(
      `This ${format} archive is unsupported or too large to preview.`,
    );
  }

  let offset = centralOffset;
  let expandedBytes = 0;
  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > centralOffset + centralSize) throw invalid();
    if (view.getUint32(offset, true) !== 0x02014b50) throw invalid();
    const uncompressedSize = view.getUint32(offset + 24, true);
    if (uncompressedSize === 0xffffffff) {
      throw new Error(`ZIP64 ${format} files cannot be previewed.`);
    }
    expandedBytes += uncompressedSize;
    if (expandedBytes > MAX_OFFICE_EXPANDED_BYTES) {
      throw new Error(`Expanded ${format} content is limited to 64 MB.`);
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset > centralOffset + centralSize) throw invalid();
}
