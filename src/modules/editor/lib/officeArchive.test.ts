import { strToU8, type Zippable, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { validateOfficeArchive } from "./officeArchive";

function officeZip(files: Record<string, string>): Uint8Array {
  const entries: Zippable = Object.fromEntries(
    Object.entries(files).map(([name, content]) => [
      name,
      [strToU8(content), { level: 6 }],
    ]),
  );
  return zipSync(entries);
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function lieAboutExpandedSize(archive: Uint8Array, size: number): Uint8Array {
  const bytes = archive.slice();
  const view = new DataView(bytes.buffer);
  let endRecord = bytes.length - 22;
  while (endRecord >= 0 && view.getUint32(endRecord, true) !== 0x06054b50) {
    endRecord--;
  }
  if (endRecord < 0) throw new Error("Test ZIP is missing its end record.");
  const centralOffset = view.getUint32(endRecord + 16, true);
  const localOffset = view.getUint32(centralOffset + 42, true);
  view.setUint32(centralOffset + 24, size, true);
  view.setUint32(localOffset + 22, size, true);
  return bytes;
}

describe("validateOfficeArchive", () => {
  it("accepts a small deflated DOCX archive", async () => {
    const archive = officeZip({
      "word/document.xml": "<document>hello</document>",
    });

    await expect(
      validateOfficeArchive(asArrayBuffer(archive), "DOCX"),
    ).resolves.toBeUndefined();
  });

  it("limits the actual inflated bytes when the ZIP size fields lie", async () => {
    const archive = officeZip({
      "word/document.xml": "x".repeat(4096),
    });
    const forged = lieAboutExpandedSize(archive, 1);

    await expect(
      validateOfficeArchive(asArrayBuffer(forged), "DOCX", {
        maxExpandedBytes: 128,
      }),
    ).rejects.toThrow("Expanded DOCX content is limited");
  });

  it("rejects XLSX cell references that exceed the dense parse limit", async () => {
    const archive = officeZip({
      "xl/workbook.xml":
        '<workbook><sheets><sheet name="Only" sheetId="1" r:id="rId1"/></sheets></workbook>',
      "xl/worksheets/sheet1.xml":
        '<worksheet><dimension ref="A1"/><sheetData><row r="1048576"><c r="XFD1048576"><v>1</v></c></row></sheetData></worksheet>',
    });

    await expect(
      validateOfficeArchive(asArrayBuffer(archive), "XLSX"),
    ).rejects.toThrow("XLSX preview is limited to");
  });

  it("rejects workbooks with more sheets than the preview supports", async () => {
    const archive = officeZip({
      "xl/workbook.xml":
        '<workbook><sheets><sheet name="One"/><sheet name="Two"/></sheets></workbook>',
    });

    await expect(
      validateOfficeArchive(asArrayBuffer(archive), "XLSX", {
        maxSpreadsheetSheets: 1,
      }),
    ).rejects.toThrow("limited to 1 worksheets");
  });
  it("counts unreferenced cells even when tags cross input chunks", async () => {
    const xml = `<worksheet><sheetData>${" ".repeat(32768 - 24)}<c/><c/><c/></sheetData></worksheet>`;
    const archive = zipSync({
      "xl/worksheets/sheet1.xml": [strToU8(xml), { level: 0 }],
    });
    await expect(
      validateOfficeArchive(asArrayBuffer(archive), "XLSX", {
        maxSpreadsheetCells: 2,
      }),
    ).rejects.toThrow("XLSX preview is limited");
    await expect(
      validateOfficeArchive(asArrayBuffer(archive), "XLSX", {
        maxSpreadsheetCells: 3,
      }),
    ).resolves.toBeUndefined();
  });

  it("ignores non-dimension ranges when estimating worksheet size", async () => {
    const archive = officeZip({
      "xl/worksheets/sheet1.xml":
        '<worksheet><dimension ref="A1:A100"/><sheetData><row r="100"><c r="A100"/></row></sheetData><mergeCells><mergeCell ref="A1:XFD1"/></mergeCells><autoFilter ref="A1:XFD100"/></worksheet>',
    });
    await expect(
      validateOfficeArchive(asArrayBuffer(archive), "XLSX", {
        maxSpreadsheetCells: 100,
      }),
    ).resolves.toBeUndefined();
  });
  it("stops validation when the preview is cancelled", async () => {
    const archive = officeZip({ "word/document.xml": "<document/>" });
    await expect(
      validateOfficeArchive(asArrayBuffer(archive), "DOCX", {
        isCancelled: () => true,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
