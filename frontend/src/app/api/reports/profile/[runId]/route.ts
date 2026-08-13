import { readFileSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";

type ReportPayload = {
  profile: {
    dataset?: { name?: string };
    run: {
      id: string;
      version?: number;
      created_at?: string;
      scan_mode?: string;
      row_count?: number;
      status?: string;
      is_approximate?: boolean;
      random_seed?: number;
      narrative_report?: string | null;
      risk_warnings?: string[];
    };
    column_stats: Array<Record<string, unknown>>;
    proposals: Record<string, Array<Record<string, unknown>>>;
    test_results: Array<Record<string, unknown>>;
    drift_reports: Array<Record<string, unknown>>;
  };
  analysis_sessions: Array<{
    id: string;
    goal?: string;
    mode?: string;
    status?: string;
    created_at?: string;
    quality_gate?: { decision?: string };
    executions?: Array<Record<string, unknown>>;
  }>;
  export_sections?: string[];
};

const ALL_EXPORT_SECTIONS = ["overview", "technical_profile", "quality", "tests", "drift", "agent_summary", "analysis"];

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 44;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM = 52;

const COLORS = {
  navy: "0.10 0.17 0.31",
  blue: "0.12 0.42 0.72",
  paleBlue: "0.93 0.96 0.99",
  paleGray: "0.97 0.98 0.99",
  gray: "0.38 0.43 0.50",
  border: "0.82 0.85 0.89",
  ink: "0.12 0.15 0.20",
  white: "1 1 1",
  warning: "0.91 0.53 0.08",
  paleWarning: "1 0.96 0.88",
};

function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

type Cmap4 = {
  offset: number;
  segments: Array<{ start: number; end: number; delta: number; rangeOffset: number; rangeOffsetAddress: number }>;
};

type Cmap12 = {
  offset: number;
  groups: Array<{ start: number; end: number; glyph: number }>;
};

type PdfFont = {
  bytes: Uint8Array;
  unitsPerEm: number;
  glyphForCodePoint: (codePoint: number) => number;
  advanceForCodePoint: (codePoint: number) => number;
};

function loadPdfFont(): PdfFont {
  const fontPath = process.env.PDF_FONT_PATH || join(process.cwd(), "public", "fonts", "arial.ttf");
  const bytes = new Uint8Array(readFileSync(fontPath));
  const tables = new Map<string, { offset: number; length: number }>();
  const tableCount = u16(bytes, 4);
  for (let index = 0; index < tableCount; index += 1) {
    const offset = 12 + index * 16;
    const tag = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    tables.set(tag, { offset: u32(bytes, offset + 8), length: u32(bytes, offset + 12) });
  }

  const head = tables.get("head");
  const hhea = tables.get("hhea");
  const hmtx = tables.get("hmtx");
  const maxp = tables.get("maxp");
  const cmap = tables.get("cmap");
  if (!head || !hhea || !hmtx || !maxp || !cmap) throw new Error("PDF font tables are incomplete.");

  const unitsPerEm = u16(bytes, head.offset + 18);
  const glyphCount = u16(bytes, maxp.offset + 4);
  const metricCount = u16(bytes, hhea.offset + 34);
  const advances = new Uint16Array(glyphCount);
  for (let index = 0; index < glyphCount; index += 1) {
    const metricIndex = Math.min(index, metricCount - 1);
    advances[index] = u16(bytes, hmtx.offset + metricIndex * 4);
  }

  let cmap4: Cmap4 | undefined;
  let cmap12: Cmap12 | undefined;
  const cmapTables = u16(bytes, cmap.offset + 2);
  for (let index = 0; index < cmapTables; index += 1) {
    const record = cmap.offset + 4 + index * 8;
    const subtableOffset = cmap.offset + u32(bytes, record + 4);
    const format = u16(bytes, subtableOffset);
    if (format === 12 && !cmap12) {
      const groups = Array.from({ length: u32(bytes, subtableOffset + 12) }, (_, groupIndex) => {
        const group = subtableOffset + 16 + groupIndex * 12;
        return { start: u32(bytes, group), end: u32(bytes, group + 4), glyph: u32(bytes, group + 8) };
      });
      cmap12 = { offset: subtableOffset, groups };
    }
    if (format === 4 && !cmap4) {
      const segmentCount = u16(bytes, subtableOffset + 6) / 2;
      const endCode = subtableOffset + 14;
      const startCode = endCode + segmentCount * 2 + 2;
      const idDelta = startCode + segmentCount * 2;
      const idRangeOffset = idDelta + segmentCount * 2;
      const segments = Array.from({ length: segmentCount }, (_, segmentIndex) => ({
        start: u16(bytes, startCode + segmentIndex * 2),
        end: u16(bytes, endCode + segmentIndex * 2),
        delta: u16(bytes, idDelta + segmentIndex * 2),
        rangeOffset: u16(bytes, idRangeOffset + segmentIndex * 2),
        rangeOffsetAddress: idRangeOffset + segmentIndex * 2,
      }));
      cmap4 = { offset: subtableOffset, segments };
    }
  }

  const glyphForCodePoint = (codePoint: number): number => {
    if (codePoint < 0 || codePoint > 0xffff) return 0;
    if (cmap12) {
      let low = 0;
      let high = cmap12.groups.length - 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const group = cmap12.groups[middle];
        if (codePoint < group.start) high = middle - 1;
        else if (codePoint > group.end) low = middle + 1;
        else return group.glyph + codePoint - group.start;
      }
    }
    if (cmap4) {
      let low = 0;
      let high = cmap4.segments.length - 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const segment = cmap4.segments[middle];
        if (codePoint > segment.end) low = middle + 1;
        else if (codePoint < segment.start) high = middle - 1;
        else if (segment.rangeOffset === 0) return (codePoint + segment.delta) & 0xffff;
        else {
          const glyphAddress = segment.rangeOffsetAddress + segment.rangeOffset + (codePoint - segment.start) * 2;
          const glyph = u16(bytes, glyphAddress);
          return glyph === 0 ? 0 : (glyph + segment.delta) & 0xffff;
        }
      }
    }
    return 0;
  };

  const advanceForCodePoint = (codePoint: number): number => {
    const glyph = glyphForCodePoint(codePoint) || glyphForCodePoint(63);
    return advances[glyph] || unitsPerEm * 0.55;
  };
  return { bytes, unitsPerEm, glyphForCodePoint, advanceForCodePoint };
}

const PDF_FONT = loadPdfFont();

function cell(value: unknown, maxLength = 150): string {
  if (value === null || value === undefined || value === "") return "-";
  const raw = typeof value === "object" ? JSON.stringify(value) : String(value);
  return raw.length > maxLength ? `${raw.slice(0, maxLength - 3)}...` : raw;
}

function date(value: unknown): string {
  if (!value) return "-";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString().slice(0, 10);
}

function cleanText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

function plainReportLine(value: string): string {
  return value
    .replace(/^\s{0,3}#{1,6}\s*/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+\.\s+/, "")
    .replace(/^\s*>\s*/, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*{2,}/g, "")
    .trim();
}

function textWidth(value: string, size: number): number {
  return Array.from(cleanText(value)).reduce((total, character) => total + PDF_FONT.advanceForCodePoint(character.codePointAt(0) || 63), 0) / PDF_FONT.unitsPerEm * size;
}

function wrap(value: string, maxWidth: number, size: number): string[] {
  const text = cleanText(value);
  if (!text) return [""];
  const lines: string[] = [];
  let current = "";
  const pushWord = (word: string) => {
    if (!current) { current = word; return; }
    const candidate = `${current} ${word}`;
    if (textWidth(candidate, size) <= maxWidth) current = candidate;
    else { lines.push(current); current = word; }
  };
  for (const word of text.split(" ")) {
    if (textWidth(word, size) <= maxWidth) pushWord(word);
    else {
      if (current) { lines.push(current); current = ""; }
      let part = "";
      for (const character of Array.from(word)) {
        if (part && textWidth(part + character, size) > maxWidth) { lines.push(part); part = character; }
        else part += character;
      }
      if (part) current = part;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function fitLines(value: string, maxWidth: number, size: number, maxLines: number): string[] {
  const lines = wrap(value, maxWidth, size);
  if (lines.length <= maxLines) return lines;
  const result = lines.slice(0, maxLines);
  let last = result[maxLines - 1];
  while (last.length > 3 && textWidth(`${last}...`, size) > maxWidth) last = last.slice(0, -1);
  result[maxLines - 1] = `${last}...`;
  return result;
}

function encodePdfText(value: string): string {
  let hex = "";
  for (const character of cleanText(value)) {
    const codePoint = character.codePointAt(0) || 63;
    const safeCodePoint = codePoint <= 0xffff && PDF_FONT.glyphForCodePoint(codePoint) ? codePoint : 63;
    hex += safeCodePoint.toString(16).padStart(4, "0");
  }
  return `<${hex}>`;
}

function bytesFromText(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  parts.forEach((part) => { result.set(part, offset); offset += part.length; });
  return result;
}

function streamObject(data: Uint8Array, dictionary = ""): Uint8Array {
  return concatBytes(bytesFromText(`<< /Length ${data.length}${dictionary} >>\nstream\n`), data, bytesFromText("\nendstream"));
}

function makeCidToGidMap(): Uint8Array {
  const map = new Uint8Array(0x10000 * 2);
  for (let codePoint = 0; codePoint <= 0xffff; codePoint += 1) {
    const glyph = PDF_FONT.glyphForCodePoint(codePoint);
    map[codePoint * 2] = (glyph >> 8) & 0xff;
    map[codePoint * 2 + 1] = glyph & 0xff;
  }
  return map;
}

function makeFontWidths(pages: string[]): string {
  const codePoints = new Set<number>();
  pages.forEach((page) => {
    for (const match of page.matchAll(/<([0-9a-f]+)>/g)) {
      const encoded = match[1];
      for (let index = 0; index + 3 < encoded.length; index += 4) codePoints.add(Number.parseInt(encoded.slice(index, index + 4), 16));
    }
  });
  const widths = [...codePoints].sort((left, right) => left - right).map((codePoint) => {
    const width = Math.round(PDF_FONT.advanceForCodePoint(codePoint) / PDF_FONT.unitsPerEm * 1000);
    return `${codePoint} [${width}]`;
  });
  return `/W [${widths.join(" ")}]`;
}

type Page = { commands: string[]; y: number };

function textCommand(commands: string[], x: number, y: number, value: string, size = 9, bold = false, color = COLORS.ink) {
  commands.push(`q ${color} rg BT /F${bold ? "2" : "1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${encodePdfText(value)} Tj ET Q`);
}

function rectCommand(commands: string[], x: number, y: number, width: number, height: number, fill: string, stroke?: string) {
  commands.push(`q ${fill} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f Q`);
  if (stroke) commands.push(`q ${stroke} RG 0.6 w ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S Q`);
}

function lineCommand(commands: string[], x1: number, y1: number, x2: number, y2: number, color = COLORS.border, width = 0.6) {
  commands.push(`q ${color} RG ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`);
}

function equalWidths(count: number): number[] {
  return Array.from({ length: count }, () => CONTENT_WIDTH / Math.max(count, 1));
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(/%/g, "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function percentage(value: unknown): number | null {
  const parsed = numeric(value);
  if (parsed === null) return null;
  return Math.max(0, Math.min(100, parsed));
}

function ratioPercentage(value: unknown): number | null {
  const parsed = numeric(value);
  if (parsed === null) return null;
  return Math.max(0, Math.min(100, parsed <= 1 ? parsed * 100 : parsed));
}

function buildLayout(payload: ReportPayload): string[] {
  const { profile, analysis_sessions: sessions } = payload;
  const selectedSections = new Set(payload.export_sections || ALL_EXPORT_SECTIONS);
  const run = profile.run;
  const pages: Page[] = [];
  let page: Page;

  const startPage = () => {
    page = { commands: [], y: PAGE_HEIGHT - 64 };
    pages.push(page);
    rectCommand(page.commands, 0, PAGE_HEIGHT - 34, PAGE_WIDTH, 34, COLORS.navy);
    textCommand(page.commands, MARGIN, PAGE_HEIGHT - 22, "P-170  |  BÁO CÁO HỒ SƠ DỮ LIỆU", 8, true, COLORS.white);
    textCommand(page.commands, PAGE_WIDTH - MARGIN - 126, PAGE_HEIGHT - 22, "Evidence-first export", 7, false, "0.82 0.88 0.96");
  };

  const ensure = (height: number) => {
    if (page.y - height < BOTTOM) startPage();
  };

  let activeSection = "overview";
  let topHeadingNumber = 0;
  let subHeadingNumber = 0;
  let detailHeadingNumber = 0;
  const sectionByHeading = ["overview", "technical_profile", "quality", "tests", "drift", "agent_summary", "analysis"];

  const addParagraph = (value: string, size = 9, color = COLORS.ink, width = CONTENT_WIDTH - 10) => {
    if (!selectedSections.has(activeSection)) return;
    const leading = size + 4;
    for (const line of wrap(value, width, size)) {
      ensure(leading);
      textCommand(page.commands, MARGIN, page.y, line, size, false, color);
      page.y -= leading;
    }
    page.y -= 4;
  };

  const addHeading = (title: string, level = 1) => {
    if (level === 1) {
      topHeadingNumber += 1;
      subHeadingNumber = 0;
      detailHeadingNumber = 0;
      activeSection = sectionByHeading[topHeadingNumber - 1] || "";
      title = `${topHeadingNumber}. ${title}`;
    } else if (level === 2) {
      subHeadingNumber += 1;
      detailHeadingNumber = 0;
      title = `${topHeadingNumber}.${subHeadingNumber} ${title}`;
    } else if (level === 3) {
      detailHeadingNumber += 1;
      title = `${topHeadingNumber}.${subHeadingNumber}.${detailHeadingNumber} ${title}`;
    }
    if (!selectedSections.has(activeSection)) return;
    const size = level === 1 ? 12 : 10;
    const lines = fitLines(title, CONTENT_WIDTH - 24, size, 2);
    const height = Math.max(level === 1 ? 21 : 18, 8 + lines.length * (size + 2));
    ensure(height + 10);
    page.y -= 8;
    const top = page.y;
    rectCommand(page.commands, MARGIN, top - height + 2, level === 1 ? 5 : 3, height, level === 1 ? COLORS.blue : COLORS.border);
    lines.forEach((line, index) => textCommand(page.commands, MARGIN + 13, top - (level === 1 ? 14 : 12) - index * (size + 2), line, size, true, level === 1 ? COLORS.navy : COLORS.ink));
    page.y = top - height - 8;
  };

  const addCallout = (value: string, warning = false) => {
    if (!selectedSections.has(activeSection)) return;
    const lines = wrap(value, CONTENT_WIDTH - 30, 8.2);
    const height = 16 + lines.length * 11;
    ensure(height + 8);
    const top = page.y;
    rectCommand(page.commands, MARGIN, top - height, CONTENT_WIDTH, height, warning ? COLORS.paleWarning : COLORS.paleBlue, COLORS.border);
    rectCommand(page.commands, MARGIN, top - height, 5, height, warning ? COLORS.warning : COLORS.blue);
    lines.forEach((line, index) => textCommand(page.commands, MARGIN + 14, top - 14 - index * 11, line, 8.2, false, COLORS.ink));
    page.y = top - height - 9;
  };

  const addBarChart = (
    title: string,
    rows: Array<{ label: string; value: number }>,
    color = COLORS.blue,
  ) => {
    if (!selectedSections.has(activeSection)) return;
    const visibleRows = rows.sort((left, right) => right.value - left.value).slice(0, 10);
    if (!visibleRows.length) return;
    const rowHeight = 20;
    const height = 42 + visibleRows.length * rowHeight;
    ensure(height + 8);
    const top = page.y;
    rectCommand(page.commands, MARGIN, top - height, CONTENT_WIDTH, height, COLORS.white, COLORS.border);
    textCommand(page.commands, MARGIN + 12, top - 17, title, 9.2, true, COLORS.navy);
    const labelWidth = 112;
    const plotX = MARGIN + labelWidth;
    const plotWidth = CONTENT_WIDTH - labelWidth - 48;
    const plotTop = top - 39;
    visibleRows.forEach((row, index) => {
      const centerY = plotTop - index * rowHeight;
      const label = fitLines(row.label, labelWidth - 14, 7.1, 1)[0];
      textCommand(page.commands, MARGIN + 8, centerY - 2, label, 7.1, false, COLORS.gray);
      rectCommand(page.commands, plotX, centerY - 7, plotWidth, 10, COLORS.paleBlue);
      rectCommand(page.commands, plotX, centerY - 7, plotWidth * row.value / 100, 10, color);
      textCommand(page.commands, MARGIN + CONTENT_WIDTH - 31, centerY - 2, `${row.value.toFixed(1)}%`, 7.1, true, COLORS.ink);
    });
    page.y = top - height - 10;
  };

  const addTable = (headers: string[], rows: string[][], widths: number[]) => {
    if (!selectedSections.has(activeSection)) return;
    if (!headers.length) return;
    const drawHeader = () => {
      const height = 25;
      ensure(height);
      const top = page.y;
      rectCommand(page.commands, MARGIN, top - height, CONTENT_WIDTH, height, COLORS.navy);
      let x = MARGIN;
      headers.forEach((header, index) => {
        const headerLines = fitLines(header, widths[index] - 12, 7.2, 2);
        headerLines.forEach((line, lineIndex) => textCommand(page.commands, x + 6, top - 11 - lineIndex * 8, line, 7.2, true, COLORS.white));
        if (index > 0) lineCommand(page.commands, x, top - height, x, top, COLORS.white, 0.35);
        x += widths[index];
      });
      lineCommand(page.commands, MARGIN, top - height, MARGIN + CONTENT_WIDTH, top - height, COLORS.border);
      page.y = top - height;
    };

    drawHeader();
    rows.forEach((row, rowIndex) => {
      const wrapped = row.map((value, index) => fitLines(value, Math.max(16, widths[index] - 12), 7.1, 4));
      const height = Math.max(23, Math.max(...wrapped.map((lines) => lines.length), 1) * 10 + 8);
      if (page.y - height < BOTTOM) {
        startPage();
        drawHeader();
      }
      const top = page.y;
      rectCommand(page.commands, MARGIN, top - height, CONTENT_WIDTH, height, rowIndex % 2 === 0 ? COLORS.paleGray : COLORS.white);
      let x = MARGIN;
      wrapped.forEach((lines, index) => {
        lines.forEach((line, lineIndex) => textCommand(page.commands, x + 6, top - 13 - lineIndex * 10, line, 7.1, false, COLORS.ink));
        if (index > 0) lineCommand(page.commands, x, top - height, x, top, COLORS.border, 0.35);
        x += widths[index];
      });
      lineCommand(page.commands, MARGIN, top - height, MARGIN + CONTENT_WIDTH, top - height, COLORS.border);
      page.y = top - height;
    });
    page.y -= 8;
  };

  const addAgentSummary = (report: string) => {
    let metricRows: string[][] = [];
    let firstContent = true;
    const flushMetrics = () => {
      if (metricRows.length) addTable(["Chỉ số", "Giá trị"], metricRows, [165, 342]);
      metricRows = [];
    };

    report.split(/\r?\n/).forEach((rawLine) => {
      const line = plainReportLine(rawLine);
      if (!line) return;
      const markedHeading = /^\s*(?:#{1,6}\s+|\*{1,2}[^*].*\*{1,2}\s*$)/.test(rawLine);
      const colonIndex = line.indexOf(":");
      const label = colonIndex > 0 ? line.slice(0, colonIndex).trim() : "";
      const value = colonIndex > 0 ? line.slice(colonIndex + 1).trim() : "";
      const shortTitle = line.length <= 54 && !/[.!?]$/.test(line) && !/^\d/.test(line);

      if (markedHeading || (colonIndex < 0 && (firstContent || shortTitle))) {
        flushMetrics();
        addHeading(line, 2);
      } else if (colonIndex > 0 && label && value) {
        metricRows.push([label, value]);
      } else if (colonIndex > 0 && label && !value) {
        flushMetrics();
        addHeading(label, 2);
      } else {
        flushMetrics();
        addParagraph(line);
      }
      firstContent = false;
    });
    flushMetrics();
  };

  page = { commands: [], y: PAGE_HEIGHT - 80 };
  pages.push(page);
  rectCommand(page.commands, 0, 0, PAGE_WIDTH, PAGE_HEIGHT, COLORS.paleGray);
  rectCommand(page.commands, 0, PAGE_HEIGHT - 230, PAGE_WIDTH, 230, COLORS.navy);
  rectCommand(page.commands, 0, 0, 13, PAGE_HEIGHT, COLORS.blue);
  textCommand(page.commands, MARGIN, PAGE_HEIGHT - 78, "P-170", 15, true, COLORS.white);
  textCommand(page.commands, MARGIN, PAGE_HEIGHT - 126, "Báo cáo hồ sơ dữ liệu", 27, true, COLORS.white);
  textCommand(page.commands, MARGIN, PAGE_HEIGHT - 160, "Phân tích kỹ thuật và bằng chứng từ Analysis", 11, false, "0.83 0.89 0.97");
  fitLines(cell(profile.dataset?.name, 90), CONTENT_WIDTH - 20, 10, 2).forEach((line, index) => textCommand(page.commands, MARGIN, PAGE_HEIGHT - 195 - index * 12, line, 10, false, COLORS.white));

  // Keep the lower metadata row inside the white card; the baseline of the
  // sixth row is lower than the first five rows by the fixed row spacing.
  rectCommand(page.commands, MARGIN, PAGE_HEIGHT - 465, CONTENT_WIDTH, 165, COLORS.white, COLORS.border);
  textCommand(page.commands, MARGIN + 18, PAGE_HEIGHT - 335, "TỔNG QUAN BÁO CÁO", 8, true, COLORS.blue);
  const coverRows = [
    ["Profile run", cell(run.id, 54)], ["Ngày tạo", date(run.created_at)], ["Trạng thái", cell(run.status)],
    ["Số dòng", cell(run.row_count)], ["Chế độ quét", `${cell(run.scan_mode)}${run.is_approximate ? " (xấp xỉ)" : ""}`],
    ["Đề xuất PII đang hoạt động", String((profile.proposals?.pii || []).filter((item) => item.status !== "rejected").length)],
  ];
  coverRows.forEach(([label, value], index) => {
    const y = PAGE_HEIGHT - 360 - index * 19;
    textCommand(page.commands, MARGIN + 18, y, label, 8.2, true, COLORS.gray);
    textCommand(page.commands, MARGIN + 170, y, value, 8.5, false, COLORS.ink);
  });
  textCommand(page.commands, MARGIN, 116, "Báo cáo kết hợp hồ sơ kỹ thuật với các phiên Analysis được liên kết.", 8.5, false, COLORS.gray);
  textCommand(page.commands, MARGIN, 96, "Dữ liệu dòng thô không được đưa vào; giá trị PII được che trong bản xuất.", 8.5, false, COLORS.gray);

  startPage();
  addHeading("Tổng quan dataset");
  addTable(["Trường", "Giá trị"], [
    ["Dataset", cell(profile.dataset?.name)], ["Profile run", cell(run.id)], ["Phiên bản", cell(run.version)],
    ["Ngày tạo", date(run.created_at)], ["Trạng thái", cell(run.status)],
    ["Chế độ quét", `${cell(run.scan_mode)}${run.is_approximate ? " (xấp xỉ)" : ""}`], ["Số dòng", cell(run.row_count)], ["Random seed", cell(run.random_seed)],
  ], [145, 362]);

  addHeading("Hồ sơ kỹ thuật");
  const columnRows = (profile.column_stats || []).map((stat) => [
    cell(stat.column_name, 34), cell(stat.dtype, 18), cell(stat.null_pct, 14), cell(stat.cardinality, 14),
    cell(stat.uniqueness_ratio, 14), cell(stat.mean, 14), cell(stat.outlier_count, 14), stat.pii_masked ? "Đã che" : "Không",
  ]);
  if (columnRows.length) addTable(["Cột", "Kiểu", "% null", "Cardinality", "Unique", "Mean", "Ngoại lệ", "PII"], columnRows, [88, 58, 50, 70, 65, 58, 65, 53]);
  else addCallout("Không có thống kê cột được lưu cho profile này.");
  const profileStats = (profile.column_stats || []).map((stat) => ({
    label: cell(stat.column_name, 30),
    nullRate: percentage(stat.null_pct),
    uniqueRate: ratioPercentage(stat.uniqueness_ratio),
  }));
  addBarChart("Tỷ lệ null theo cột (10 cột cao nhất)", profileStats.filter((item): item is { label: string; nullRate: number; uniqueRate: number } => item.nullRate !== null).map((item) => ({ label: item.label, value: item.nullRate })), COLORS.warning);
  addBarChart("Tỷ lệ unique theo cột (10 cột cao nhất)", profileStats.filter((item): item is { label: string; nullRate: number; uniqueRate: number } => item.uniqueRate !== null).map((item) => ({ label: item.label, value: item.uniqueRate })), COLORS.blue);

  addHeading("Chất lượng, quyền riêng tư và giới hạn");
  if (run.risk_warnings?.length) run.risk_warnings.forEach((warning) => addCallout(warning, true));
  addCallout("Dữ liệu dòng thô không được đưa vào. Giá trị PII được che, bao gồm cả các đề xuất PII đang chờ duyệt. Kết quả tổng hợp giữ execution ID và result hash để đối chiếu.");

  addHeading("Kiểm định thống kê");
  if (profile.test_results.length) addTable(["Kiểm định", "Cột mục tiêu", "Kết luận", "p-value"], profile.test_results.map((item) => [cell(item.test_type), cell(item.target_columns), cell(item.conclusion || item.interpretation), cell(item.p_value)]), [85, 105, 237, 80]);
  else addCallout("Không có kiểm định thống kê nào được ghi nhận.");

  addHeading("Báo cáo drift");
  if (profile.drift_reports.length) addTable(["Profile A", "Profile B", "Tóm tắt"], profile.drift_reports.map((item) => [cell(item.profile_run_id_a), cell(item.profile_run_id_b), cell(item.summary)]), [112, 112, 283]);
  else addCallout("Không có báo cáo drift nào được ghi nhận.");

  addHeading("Tóm tắt từ Agent");
  addAgentSummary(run.narrative_report || "Chưa có báo cáo diễn giải.");

  addHeading("Các phiên phân tích nghiệp vụ");
  if (!sessions.length) addCallout("Chưa có phiên Analysis được liên kết. Bạn có thể thêm Analysis để có insight nghiệp vụ, hoặc bỏ qua và xuất trực tiếp báo cáo kỹ thuật.");
  sessions.forEach((session, sessionIndex) => {
    addHeading(cell(session.goal), 2);
    addTable(["Trường", "Giá trị"], [
      ["Session", cell(session.id)], ["Chế độ", cell(session.mode)], ["Trạng thái", cell(session.status)],
      ["Ngày tạo", date(session.created_at)], ["Quality gate", cell(session.quality_gate?.decision)],
    ], [145, 362]);
    (session.executions || []).forEach((execution, executionIndex) => {
      addHeading(`Execution ${executionIndex + 1}: ${cell(execution.id, 54)}`, 3);
      const result = (execution.result || {}) as { columns?: string[]; data?: Array<Record<string, unknown>> };
      const columns = (result.columns || (result.data?.[0] ? Object.keys(result.data[0]) : [])).slice(0, 6);
      if (columns.length && result.data?.length) {
        const rows = result.data.slice(0, 25).map((row) => columns.map((column) => cell(row[column], 48)));
        addTable(columns, rows, equalWidths(columns.length));
        if (result.data.length > 25) addParagraph(`Đang hiển thị 25 dòng đầu trên tổng số ${result.data.length} dòng kết quả.`, 8, COLORS.gray);
      } else addCallout("Execution này không có kết quả dạng bảng.");
      addParagraph(`Evidence hash: ${cell(execution.result_hash)} | Thời lượng: ${cell(execution.duration_ms)} ms | Xấp xỉ: ${cell(execution.is_approximate)}`, 8, COLORS.gray);
    });
  });

  addCallout("Chính sách export: báo cáo kết hợp hồ sơ kỹ thuật với bằng chứng Analysis được liên kết. Báo cáo không chứa dữ liệu dòng thô hoặc PII chưa che.");

  return pages.map((item, index) => {
    textCommand(item.commands, MARGIN, 24, "Bảo mật  |  Bản xuất đã che PII", 7.2, false, COLORS.gray);
    textCommand(item.commands, PAGE_WIDTH - MARGIN - 62, 24, `Trang ${index + 1} / ${pages.length}`, 7.2, false, COLORS.gray);
    item.commands.push(`q ${COLORS.border} RG 0.6 w ${MARGIN} 36 m ${PAGE_WIDTH - MARGIN} 36 l S Q`);
    return item.commands.join("\n");
  });
}

function buildPdf(payload: ReportPayload): Uint8Array {
  const pages = buildLayout(payload);
  const objects = new Map<number, Uint8Array>();
  const fontFileId = 3;
  const cidMapId = 4;
  const descriptorId = 5;
  const cidFontId = 6;
  const type0FontId = 7;
  const pageIds = pages.map((_, index) => 8 + index * 2);
  const contentIds = pages.map((_, index) => 9 + index * 2);
  const fontWidths = makeFontWidths(pages);
  objects.set(1, bytesFromText("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.set(2, bytesFromText(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`));
  objects.set(fontFileId, streamObject(PDF_FONT.bytes));
  objects.set(cidMapId, streamObject(makeCidToGidMap()));
  objects.set(descriptorId, bytesFromText(`<< /Type /FontDescriptor /FontName /Arial /Flags 4 /FontBBox [-665 -325 2000 1000] /ItalicAngle 0 /Ascent 905 /Descent -212 /CapHeight 716 /StemV 80 /FontFile2 ${fontFileId} 0 R >>`));
  objects.set(cidFontId, bytesFromText(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Arial /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptorId} 0 R /CIDToGIDMap ${cidMapId} 0 R /DW 600 ${fontWidths} >>`));
  objects.set(type0FontId, bytesFromText(`<< /Type /Font /Subtype /Type0 /BaseFont /Arial /Encoding /Identity-H /DescendantFonts [${cidFontId} 0 R] >>`));
  pages.forEach((content, index) => {
    objects.set(pageIds[index], bytesFromText(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${type0FontId} 0 R /F2 ${type0FontId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`));
    objects.set(contentIds[index], streamObject(bytesFromText(content)));
  });

  let output = bytesFromText("%PDF-1.4\n");
  const offsets = [0];
  const maxObjectId = Math.max(...objects.keys());
  for (let id = 1; id <= maxObjectId; id += 1) {
    offsets[id] = output.length;
    output = concatBytes(output, bytesFromText(`${id} 0 obj\n`), objects.get(id) || new Uint8Array(), bytesFromText("\nendobj\n"));
  }
  const xrefOffset = output.length;
  let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < offsets.length; id += 1) xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  output = concatBytes(output, bytesFromText(`${xref}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));
  return output;
}

async function getReport(runId: string, request: Request, sections?: string): Promise<ReportPayload> {
  const base = (process.env.NEXT_PUBLIC_API_URL || process.env.INTERNAL_API_URL || "http://localhost:8000/api/v1").replace(/\/$/, "");
  const headers: Record<string, string> = { Accept: "application/json" };
  const authorization = request.headers.get("authorization");
  const workspaceId = request.headers.get("x-workspace-id");
  if (authorization) headers.Authorization = authorization;
  if (workspaceId) headers["X-Workspace-Id"] = workspaceId;
  const query = sections ? `?sections=${encodeURIComponent(sections)}` : "";
  const response = await fetch(`${base}/profile/${encodeURIComponent(runId)}/report${query}`, { headers, cache: "no-store" });
  if (!response.ok) throw new Error(`Không thể lấy dữ liệu report (${response.status}).`);
  return response.json() as Promise<ReportPayload>;
}

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    const sections = new URL(request.url).searchParams.get("sections") || ALL_EXPORT_SECTIONS.join(",");
    const payload = await getReport(runId, request, sections);
    return new Response(buildPdf(payload) as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="profile-${runId}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : "Không thể tạo PDF report." }, { status: 500 });
  }
}
