import { describe, expect, it } from "vitest";
import { strToU8, type Unzipped } from "fflate";
import { parseOffice } from "../components/OfficeDocumentPreview";

const archive = (files: Record<string, string>) => Object.fromEntries(
  Object.entries(files).map(([name, value]) => [name, strToU8(value)]),
) as Unzipped;

describe("Office document preview", () => {
  it("extracts paragraphs from DOCX XML", () => {
    const result = parseOffice(archive({
      "word/document.xml": "<w:document xmlns:w='urn:w'><w:body><w:p><w:r><w:t>Báo cáo quý 3</w:t></w:r></w:p><w:p><w:r><w:t>Kết luận</w:t></w:r></w:p></w:body></w:document>",
    }), "docx");
    expect(result).toEqual({ kind: "docx", blocks: [
      { type: "paragraph", text: "Báo cáo quý 3", level: 1, list: false },
      { type: "paragraph", text: "Kết luận", level: 0, list: false },
    ] });
  });

  it("keeps DOCX heading, list, and table structure for the report layout", () => {
    const result = parseOffice(archive({
      "word/document.xml": "<w:document xmlns:w='urn:w'><w:body><w:p><w:pPr><w:pStyle w:val='Heading1'/></w:pPr><w:r><w:t>Tổng quan</w:t></w:r></w:p><w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Kết quả chính</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Chỉ số</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Giá trị</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>",
    }), "docx");
    expect(result).toEqual({ kind: "docx", blocks: [
      { type: "paragraph", text: "Tổng quan", level: 1, list: false },
      { type: "paragraph", text: "Kết quả chính", level: 0, list: true },
      { type: "table", rows: [["Chỉ số", "Giá trị"]] },
    ] });
  });

  it("resolves shared strings in XLSX XML", () => {
    const result = parseOffice(archive({
      "xl/sharedStrings.xml": "<sst xmlns='urn:x'><si><t>Doanh thu</t></si></sst>",
      "xl/workbook.xml": "<workbook xmlns='urn:x'><sheets><sheet name='Q3'/></sheets></workbook>",
      "xl/worksheets/sheet1.xml": "<worksheet xmlns='urn:x'><sheetData><row><c t='s'><v>0</v></c><c><v>120</v></c></row></sheetData></worksheet>",
    }), "xlsx");
    expect(result).toEqual({ kind: "xlsx", sheets: [{ name: "Q3", rows: [["Doanh thu", "120"]] }] });
  });

  it("extracts slide text in presentation order", () => {
    const result = parseOffice(archive({
      "ppt/slides/slide2.xml": "<p:sld xmlns:p='urn:p' xmlns:a='urn:a'><a:p><a:r><a:t>Hai</a:t></a:r></a:p></p:sld>",
      "ppt/slides/slide1.xml": "<p:sld xmlns:p='urn:p' xmlns:a='urn:a'><a:p><a:r><a:t>Một</a:t></a:r></a:p></p:sld>",
    }), "pptx");
    expect(result).toEqual({ kind: "pptx", slides: [["Một"], ["Hai"]] });
  });
});
