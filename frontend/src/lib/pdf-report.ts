import { existsSync } from "node:fs";

import { PDFDocument } from "pdf-lib";
import { chromium } from "playwright-core";

type DataRecord = Record<string, unknown>;
type ReportSource = {
  profile?: { dataset?: { name?: unknown }; run?: DataRecord; column_stats?: DataRecord[]; drift_reports?: DataRecord[]; correlation_matrix?: Record<string, Record<string, unknown>> };
  report_snapshot?: { title?: unknown; items?: DataRecord[] } | null;
};
type Section = { title: string; body: string; children?: Section[]; number?: string; isPart?: boolean; wrapBodyAndChildren?: string; skipToc?: boolean };

const MAX_CONCURRENT_EXPORTS = 2;
let activeExports = 0;

export class PdfExportError extends Error {
  constructor(message: string, readonly status = 500) { super(message); }
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function text(value: unknown, fallback = "-"): string {
  const normalized = typeof value === "string" ? value.trim() : value;
  return normalized === null || normalized === undefined || normalized === "" ? fallback : String(normalized);
}
function date(value: unknown): string {
  if (!value) return "-";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.valueOf()) ? text(value) : new Intl.DateTimeFormat("vi-VN", { dateStyle: "long", timeStyle: "short" }).format(parsed);
}
function number(value: unknown): string {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(parsed) : text(value);
}
function percentage(value: unknown): string {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return "-";
  return new Intl.NumberFormat("vi-VN", { style: "percent", maximumFractionDigits: 1 }).format(parsed > 1 ? parsed / 100 : parsed);
}
function table(headers: string[], rows: Array<Array<unknown>>, className = ""): string {
  if (!rows.length) return "";
  return `<div class="table-wrap ${className}"><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(text(value))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function inlineMarkdown(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  return html;
}
function markdown(value: unknown): string {
  const content: string[] = [];
  let list: Array<{ level: number; text: string }> = [];
  const flush = () => {
    if (!list.length) return;
    let html = "";
    let currentLevel = -1;
    for (const item of list) {
      if (item.level > currentLevel) {
        html += "<ul>".repeat(item.level - currentLevel);
      } else if (item.level < currentLevel) {
        html += "</ul>".repeat(currentLevel - item.level);
      }
      currentLevel = item.level;
      html += `<li>${item.text}</li>`;
    }
    html += "</ul>".repeat(currentLevel + 1);
    content.push(html);
    list = [];
  };
  for (const raw of text(value, "").split(/\r?\n/)) {
    const listMatch = raw.match(/^(\s*)[-*+]\s+(.*)$/);
    if (listMatch) {
      const level = Math.floor(listMatch[1].length / 2);
      list.push({ level, text: inlineMarkdown(listMatch[2]) });
      continue;
    }
    const line = raw.trim();
    if (!line || line === "---") { flush(); continue; }
    if (/^#{1,6}\s+/.test(line)) { flush(); content.push(`<h4>${inlineMarkdown(line.replace(/^#{1,6}\s+/, ""))}</h4>`); }
    else { flush(); content.push(`<p>${inlineMarkdown(line)}</p>`); }
  }
  flush();
  return content.join("") || "<p>Không có nội dung diễn giải được lưu.</p>";
}
function barChart(title: string, rows: DataRecord[]): string {
  const values = rows.slice(0, 10).map((row) => ({ label: text(row.column_name ?? row.label ?? row.name, "Khác"), value: Number(row.null_pct ?? row.value ?? row.count ?? 0) })).filter((item) => Number.isFinite(item.value));
  if (!values.length) return "";
  const max = Math.max(...values.map((item) => item.value), 1);
  const height = Math.max(180, values.length * 26 + 46);
  const bars = values.map((item, index) => { const y = 28 + index * 26; const width = Math.max(1, (item.value / max) * 270); return `<text x="0" y="${y + 12}" class="chart-label">${escapeHtml(item.label).slice(0, 22)}</text><rect x="145" y="${y}" width="${width}" height="15" rx="3" fill="#2563eb"/><text x="${150 + width}" y="${y + 12}" class="chart-value">${escapeHtml(percentage(item.value))}</text>`; }).join("");
  return `<figure class="chart"><figcaption>${escapeHtml(title)}</figcaption><svg viewBox="0 0 430 ${height}" role="img" aria-label="${escapeHtml(title)}">${bars}</svg></figure>`;
}
function evidenceChart(title: string, item: DataRecord): string {
  const content = item.content_json as DataRecord | undefined;
  const result = content?.result as DataRecord | undefined;
  const rows = Array.isArray(result?.data) ? result.data.filter((row): row is DataRecord => Boolean(row) && typeof row === "object") : [];
  const values = rows.slice(0, 10).map((row) => ({ label: text(row.label ?? row.name ?? row.category ?? row.x ?? Object.values(row)[0], "Khác"), value: Number(row.value ?? row.count ?? row.y ?? Object.values(row).find((cell) => typeof cell === "number") ?? 0) })).filter((entry) => Number.isFinite(entry.value));
  if (!values.length) return "";
  const max = Math.max(...values.map((entry) => entry.value), 1);
  const barWidth = Math.max(16, Math.floor(300 / values.length) - 6);
  const bars = values.map((entry, index) => { const height = Math.max(2, (entry.value / max) * 130); const x = 54 + index * (barWidth + 7); return `<rect x="${x}" y="${160 - height}" width="${barWidth}" height="${height}" rx="2" fill="#7c3aed"/><text x="${x}" y="176" class="chart-label">${escapeHtml(entry.label).slice(0, 11)}</text>`; }).join("");
  return `<figure class="chart evidence-chart"><figcaption>${escapeHtml(title)}</figcaption><svg viewBox="0 0 440 195" role="img" aria-label="${escapeHtml(title)}"><line x1="45" y1="160" x2="420" y2="160" stroke="#cbd5e1"/>${bars}</svg></figure>`;
}
function statRows(stats: DataRecord[]): Array<Array<unknown>> {
  return stats.map((stat) => {
    const piiTag = stat.pii_masked ? `<br/><span style="color:#b1324c;font-size:0.85em;background:#fff4f5;padding:2px 4px;border-radius:4px;display:inline-block;margin-top:2px;border:1px solid #f0c7d0;">Đã ẩn PII</span>` : "";
    let topValuesHtml = '<span style="color:#64748b">—</span>';
    
    if (stat.pii_masked) {
      topValuesHtml = `<span style="color:#b1324c;font-size:0.85em;background:#fff4f5;padding:2px 4px;border-radius:4px;display:inline-block;border:1px solid #f0c7d0;">Đã ẩn PII</span>`;
    } else {
      const topK = stat.top_values ?? stat.top_k_values;
      if (Array.isArray(topK) && topK.length > 0) {
        const topRows = topK.map(v => typeof v === 'object' && v !== null ? v : { value: String(v) }).slice(0, 5);
        if (topRows.length > 0) {
          topValuesHtml = `<div style="display:flex;flex-wrap:wrap;gap:4px;max-width:220px;">` + topRows.map(row => {
            const val = escapeHtml(String(row.value));
            const countStr = row.count !== undefined && row.count !== null ? number(row.count) : (row.frequency !== undefined && row.frequency !== null ? number(row.frequency) : "");
            const count = countStr ? ` <span style="color:#64748b;">(${countStr})</span>` : "";
            return `<span style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:2px 4px;font-size:0.85em;display:inline-block;white-space:nowrap;color:#334155;font-weight:600;">${val}${count}</span>`;
          }).join("") + `</div>`;
        }
      } else if (topK && typeof topK === 'object') {
        const entries = Object.entries(topK).slice(0, 5);
        if (entries.length > 0) {
          topValuesHtml = `<div style="display:flex;flex-wrap:wrap;gap:4px;max-width:220px;">` + entries.map(([key, val]) => {
            const count = val !== undefined && val !== null ? ` <span style="color:#64748b;">(${number(val)})</span>` : "";
            return `<span style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:2px 4px;font-size:0.85em;display:inline-block;white-space:nowrap;color:#334155;font-weight:600;">${escapeHtml(key)}${count}</span>`;
          }).join("") + `</div>`;
        }
      }
    }
    
    return [`<strong>${escapeHtml(stat.column_name)}</strong>${piiTag}`, stat.inferred_type ?? stat.dtype, percentage(stat.null_pct ?? stat.null_percentage), number(stat.cardinality ?? stat.distinct_count), percentage(stat.uniqueness_ratio), topValuesHtml];
  });
}
function buildSections(source: ReportSource): Section[] {
  const profile = source.profile || {};
  const run = profile.run || {};
  const stats = Array.isArray(profile.column_stats) ? profile.column_stats : [];
  const snapshotItems = Array.isArray(source.report_snapshot?.items) ? source.report_snapshot.items : [];
  const sections: Section[] = [];

  sections.push({ title: "PHẦN 1: HỒ SƠ & CHẤT LƯỢNG", body: "", isPart: true });
  sections.push({ title: "Tổng quan Dataset", body: table(["Trường", "Giá trị"], [["Tên dataset", text(profile.dataset?.name)], ["Profile run", text(run.id)], ["Trạng thái", text(run.status)], ["Số dòng", number(run.row_count)], ["Chế độ quét", text(run.scan_mode)], ["Ngày profiling", date(run.created_at)]]) });

  const warnings = Array.isArray(run.risk_warnings) ? run.risk_warnings : [];
  if (warnings.length) {
    const md = warnings.map((warning) => `- ⚠️ ${String(warning).replace(/'([^']+)'/g, '\`$1\`')}`).join('\n');
    sections.push({ title: "Rủi ro và giới hạn", body: `<div class="narrative">${markdown(md)}</div>` });
  }

  if (run.narrative_report) {
    const lines = String(run.narrative_report).split(/\r?\n/);
    let preamble = "";
    const children: Section[] = [];
    let currentChild: { title: string, lines: string[], subChildren: Section[] } | null = null;
    let currentSubChild: { title: string, lines: string[] } | null = null;
    let lastTopLevel = 0;
    let lastSubLevel = 0;

    const pushSubChild = () => {
      if (currentSubChild && currentChild) {
        currentChild.subChildren.push({ title: currentSubChild.title, body: markdown(currentSubChild.lines.join("\n")), skipToc: true });
        currentSubChild = null;
      }
    };

    const pushChild = () => {
      pushSubChild();
      if (currentChild) {
        children.push({ title: currentChild.title, body: markdown(currentChild.lines.join("\n")), children: currentChild.subChildren });
        currentChild = null;
      }
    };

    for (const rawLine of lines) {
      const cleanLine = rawLine.replace(/^\s*[-*+]\s+/, "").replace(/^[#\s]+/, "").replace(/\*\*/g, "");
      const match = cleanLine.match(/^(\d+)[.)]\s+(.*)$/);

      if (match) {
        const num = parseInt(match[1], 10);
        let isTopLevel = false;

        if (num === lastTopLevel + 1) {
          lastTopLevel = num;
          lastSubLevel = 0;
          isTopLevel = true;
        } else if (num === lastSubLevel + 1 || num === 1) {
          lastSubLevel = num;
          isTopLevel = false;
        } else {
          lastTopLevel = num;
          lastSubLevel = 0;
          isTopLevel = true;
        }

        if (isTopLevel) {
          pushChild();
          currentChild = { title: match[2].trim(), lines: [], subChildren: [] };
          continue;
        } else {
          pushSubChild();
          currentSubChild = { title: match[2].trim(), lines: [] };
          continue;
        }
      }

      if (currentSubChild) currentSubChild.lines.push(rawLine);
      else if (currentChild) currentChild.lines.push(rawLine);
      else preamble += rawLine + "\n";
    }
    pushChild();

    sections.push({
      title: "Tóm tắt từ Agent",
      body: preamble.trim() ? markdown(preamble.trim()) : "",
      children,
      wrapBodyAndChildren: "narrative"
    });
  }

  if (stats.length) {
    const statBody = `${table(["Cột", "Kiểu", "Null", "Cardinality", "Uniqueness", "Giá trị phổ biến"], statRows(stats))}${barChart("Tỷ lệ null theo cột", stats)}`;
    const distributions = stats.filter((stat) => !stat.pii_masked && Array.isArray(stat.top_values)).slice(0, 3);
    const distBody = distributions.length ? distributions.map((stat) => table([text(stat.column_name), "Số lượng"], (stat.top_values as DataRecord[]).slice(0, 10).map((entry) => [entry.value, number(entry.count ?? entry.frequency)]))).join("") : "";
    const correlation = profile.correlation_matrix;
    const corrBody = correlation && Object.keys(correlation).length ? table(["Cột", ...Object.keys(correlation).slice(0, 8)], Object.keys(correlation).slice(0, 8).map((column) => [column, ...Object.keys(correlation).slice(0, 8).map((peer) => { const value = Number(correlation[column]?.[peer]); return Number.isFinite(value) ? value.toFixed(2) : "-"; })]), "compact") : "";
    sections.push({ title: "Hồ sơ kỹ thuật", body: statBody + (distBody ? `<h4>Phân phối dữ liệu</h4>${distBody}` : "") + (corrBody ? `<h4>Tương quan</h4>${corrBody}` : "") });
  }

  if (snapshotItems.length) {
    sections.push({ title: "PHẦN 2: CHUYÊN ĐỀ PHÂN TÍCH", body: "", isPart: true });
    sections.push({
      title: "Biểu đồ đã ghim", body: "", children: snapshotItems.map((item, index) => {
        const content = item.content_json as DataRecord | undefined;
        const result = content?.result as DataRecord | undefined;
        const data = Array.isArray(result?.data) ? result.data.filter((row): row is DataRecord => Boolean(row) && typeof row === "object") : [];
        const reportedColumns = Array.isArray(result?.columns) ? result.columns.filter((column): column is string => typeof column === "string").slice(0, 7) : (data[0] ? Object.keys(data[0]).slice(0, 7) : []);
        const hasReportedValues = reportedColumns.some((column) => data.some((row) => row[column] !== undefined));
        const columns = hasReportedValues ? reportedColumns : (data.length ? ["Nhãn", "Giá trị"] : []);
        const tableRows = hasReportedValues
          ? data.slice(0, 40).map((row) => reportedColumns.map((column) => row[column]))
          : data.slice(0, 40).map((row) => [row.label ?? row.name ?? row.category ?? row.x, row.value ?? row.count ?? row.y]);
        const body = [item.note ? `<div class="callout"><strong>Ghi chú</strong><p>${escapeHtml(item.note)}</p></div>` : "", evidenceChart(text(item.title, `Phân tích ${index + 1}`), item), columns.length ? table(columns, tableRows) : "", content?.insight ? `<div class="narrative"><strong>Insight đã lưu</strong>${markdown(content.insight)}</div>` : "", content?.answer ? `<div class="narrative">${markdown(content.answer)}</div>` : ""].join("");
        return { title: text(item.title, `Phân tích ${index + 1}`), body: body || "<p>Không có nội dung có thể xuất cho mục này.</p>" };
      })
    });
  }

  const drifts = Array.isArray(profile.drift_reports) ? profile.drift_reports : [];
  if (drifts.length) {
    sections.push({ title: "PHẦN 3: SO SÁNH DỮ LIỆU", body: "", isPart: true });
    sections.push({ title: "Data Drift", body: table(["Profile A", "Profile B", "Tóm tắt"], drifts.map((drift) => [drift.profile_run_id_a, drift.profile_run_id_b, drift.summary])) });
  }

  return sections;
}
function numberSections(sections: Section[], prefix = ""): void { let counter = 1; sections.forEach((section) => { if (section.isPart) return; const number = prefix ? `${prefix}.${counter}` : String(counter); section.number = number; counter++; if (section.children) numberSections(section.children, number); }); }
function renderSection(section: Section, level = 2): string { if (section.isPart) return `<div class="part-divider"><h2>${escapeHtml(section.title)}</h2></div>`; const heading = `h${Math.min(level, 4)}`; const contentHtml = `${section.body}${section.children?.map((child) => renderSection(child, level + 1)).join("") || ""}`; const wrappedContent = section.wrapBodyAndChildren ? `<div class="${section.wrapBodyAndChildren}">${contentHtml}</div>` : contentHtml; return `<section class="report-section level-${level}"><${heading}>${escapeHtml(section.number)}. ${escapeHtml(section.title)}</${heading}>${wrappedContent}</section>`; }
function toc(sections: Section[]): string { const entries = (nodes: Section[]): string => nodes.filter(n => !n.skipToc).map((section) => { if (section.isPart) return `<li class="toc-part"><span>${escapeHtml(section.title)}</span></li>`; return `<li class="toc-level-${section.number?.split(".").length || 1}"><span>${escapeHtml(section.number)}. ${escapeHtml(section.title)}</span></li>${section.children && section.children.filter(c => !c.skipToc).length ? `<ol>${entries(section.children)}</ol>` : ""}`; }).join(""); return `<section class="toc"><p class="kicker">CẤU TRÚC BÁO CÁO</p><h1>Mục lục</h1><ol>${entries(sections)}</ol></section>`; }
function styles(): string {
  return `<style>@page { size: A4; margin: 18mm 16mm 18mm; }* { box-sizing: border-box; }body { color: #172033; font-family: "Noto Sans", Arial, sans-serif; font-size: 10pt; line-height: 1.52; margin: 0; }h1,h2,h3,h4 { color: #102a43; line-height: 1.25; break-after: avoid; }h2 { border-bottom: 2px solid #2563eb; font-size: 18pt; margin: 11mm 0 5mm; padding-bottom: 2.5mm; }h3 { color: #1d4ed8; font-size: 13pt; margin: 8mm 0 3mm; }h4 { font-size: 11pt; margin: 5mm 0 2mm; }p { margin: 0 0 3mm; }ul { margin: 2mm 0 4mm; padding-left: 5mm; }.toc { min-height: 220mm; }.toc h1 { font-size: 25pt; margin: 0 0 8mm; }.toc .kicker { color: #2563eb; font-size: 8pt; font-weight: 700; letter-spacing: .12em; }.toc ol { list-style: none; margin: 0; padding: 0; }.toc li { border-bottom: 1px solid #e2e8f0; padding: 2.5mm 0; }.toc ol ol { margin-left: 6mm; }.toc-level-1 { color: #102a43; font-weight: 700; }.toc-level-2 { font-size: 9.5pt; }.toc-level-3 { color: #526075; font-size: 9pt; }table { border-collapse: collapse; font-size: 8.3pt; width: 100%; }.table-wrap { margin: 3mm 0 6mm; overflow: hidden; }th { background: #eaf2ff; color: #173d6b; font-weight: 700; text-align: left; }th,td { border: 1px solid #d9e2ec; overflow-wrap: anywhere; padding: 2.1mm 2.4mm; vertical-align: top; }tr { break-inside: avoid; }thead { display: table-header-group; }.compact table { font-size: 7.5pt; }.callout { background: #eff6ff; border-left: 3px solid #2563eb; break-inside: avoid; margin: 3mm 0 5mm; padding: 3.5mm 4mm; }.warning { background: #fffbeb; border-color: #d97706; }.narrative { background: #f8fafc; border: 1px solid #e2e8f0; break-inside: avoid; margin: 3mm 0 5mm; padding: 4mm; }.chart { break-inside: avoid; margin: 5mm 0 7mm; }.chart figcaption { color: #102a43; font-size: 9pt; font-weight: 700; margin-bottom: 2mm; }.chart svg { display: block; max-height: 180mm; max-width: 100%; width: 100%; }.chart-label { fill: #526075; font-family: Arial, sans-serif; font-size: 10px; }.chart-value { fill: #173d6b; font-family: Arial, sans-serif; font-size: 10px; }.part-divider { border-bottom: 3px solid #2563eb; margin: 15mm 0 5mm; padding-bottom: 2mm; break-after: avoid; }.part-divider h2 { border: none; font-size: 16pt; font-weight: 900; color: #1e293b; margin: 0; padding: 0; }.toc-part { color: #0f172a; font-size: 11pt; font-weight: 800; margin-top: 5mm; text-transform: uppercase; border-bottom: none !important; padding-bottom: 0 !important; }</style>`;
}
function coverHtml(source: ReportSource): string {
  const profile = source.profile || {}; const run = profile.run || {};
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font-family:"Noto Sans",Arial,sans-serif}.cover{background:linear-gradient(145deg,#0f2747,#173d6b);color:#fff;height:297mm;overflow:hidden;padding:28mm 23mm;position:relative}.cover:after{background:#3b82f6;border-radius:50%;content:"";height:110mm;opacity:.23;position:absolute;right:-45mm;top:-35mm;width:110mm}.eyebrow{color:#b9d7ff;font-size:9pt;font-weight:700;letter-spacing:.16em;margin:0 0 34mm}.title{font-size:31pt;line-height:1.1;margin:0 0 9mm;max-width:130mm}.dataset{color:#dbeafe;font-size:17pt;line-height:1.4;margin:0 0 45mm;max-width:135mm}.metadata{border-top:1px solid rgba(255,255,255,.35);font-size:10pt;line-height:1.8;max-width:125mm;padding-top:7mm}.brand{bottom:23mm;color:#b9d7ff;font-size:9pt;left:23mm;position:absolute}</style></head><body><main class="cover"><p class="eyebrow">VDaAgent · DATA QUALITY</p><h1 class="title">DATA PROFILING REPORT</h1><p class="dataset">${escapeHtml(text(source.report_snapshot?.title || profile.dataset?.name, "Báo cáo hồ sơ dữ liệu"))}</p><div class="metadata"><div><strong>Dataset:</strong> ${escapeHtml(text(profile.dataset?.name))}</div><div><strong>Profile run:</strong> ${escapeHtml(text(run.id))}</div><div><strong>Ngày tạo báo cáo:</strong> ${escapeHtml(date(new Date()))}</div></div><p class="brand">Tài liệu được tạo tự động từ dữ liệu profiling đã được cấp quyền.</p></main></body></html>`;
}
function tocHtml(sections: Section[]): string { return `<!doctype html><html lang="vi"><head><meta charset="utf-8">${styles()}</head><body>${toc(sections)}</body></html>`; }
function bodyHtml(source: ReportSource, sections: Section[]): string { return `<!doctype html><html lang="vi"><head><meta charset="utf-8">${styles()}</head><body>${sections.map((section) => renderSection(section)).join("")}</body></html>`; }
function backCoverHtml(source: ReportSource): string { return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font-family:"Noto Sans",Arial,sans-serif}.back{align-items:center;background:#f1f5f9;color:#102a43;display:flex;height:297mm;justify-content:center;overflow:hidden;padding:25mm;text-align:center}.rule{background:#2563eb;height:3px;margin:9mm auto;width:28mm}h1{font-size:28pt;margin:0}p{color:#526075;font-size:11pt;line-height:1.6;max-width:110mm}.brand{font-size:9pt;font-weight:700;letter-spacing:.11em;margin-top:35mm}</style></head><body><main class="back"><div><h1>KẾT THÚC BÁO CÁO</h1><div class="rule"></div><p>Data Profiling Report cho ${escapeHtml(text(source.profile?.dataset?.name, "dataset"))}</p><p>Tài liệu này được tạo tự động từ bản phân tích đã được cấp quyền.</p><p class="brand">VDAAGENT · DATA PROFILING</p></div></main></body></html>`; }
function chromiumExecutable(): string { const candidates = [process.env.PDF_CHROMIUM_EXECUTABLE_PATH, "/usr/bin/chromium-browser", "/usr/bin/chromium", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].filter((candidate): candidate is string => Boolean(candidate)); const executable = candidates.find((candidate) => existsSync(candidate)); if (!executable) throw new PdfExportError("Máy chủ xuất PDF chưa có Chromium. Hãy cấu hình PDF_CHROMIUM_EXECUTABLE_PATH.", 503); return executable; }
async function render(browser: Awaited<ReturnType<typeof chromium.launch>>, html: string, includeFooter: boolean, datasetName: string): Promise<Uint8Array> {
  const page = await browser.newPage();
  try { await page.setContent(html, { waitUntil: "load" }); await page.evaluate(() => document.fonts.ready); const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, displayHeaderFooter: includeFooter, margin: includeFooter ? { top: "18mm", right: "16mm", bottom: "18mm", left: "16mm" } : { top: "0", right: "0", bottom: "0", left: "0" }, headerTemplate: includeFooter ? `<div style="color:#64748b;font-family:Arial,sans-serif;font-size:8px;margin-left:16mm;width:178mm;">${escapeHtml(datasetName)} · Data Profiling Report</div>` : "<span></span>", footerTemplate: includeFooter ? `<div style="color:#64748b;font-family:Arial,sans-serif;font-size:8px;margin-left:16mm;text-align:right;width:178mm;">Trang <span class="pageNumber"></span></div>` : "<span></span>" }); return Uint8Array.from(pdf); } finally { await page.close(); }
}
async function merge(parts: Uint8Array[]): Promise<Uint8Array> { const output = await PDFDocument.create(); for (const bytes of parts) { const input = await PDFDocument.load(bytes); const pages = await output.copyPages(input, input.getPageIndices()); pages.forEach((page) => output.addPage(page)); } return output.save(); }
export async function generateProfilingPdf(input: Record<string, unknown>): Promise<Uint8Array> {
  if (activeExports >= MAX_CONCURRENT_EXPORTS) throw new PdfExportError("Máy chủ đang xử lý nhiều yêu cầu xuất PDF. Vui lòng thử lại sau ít phút.", 429);
  activeExports += 1; let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try { const source = input as ReportSource; const sections = buildSections(source); numberSections(sections); browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox"] }); const datasetName = text(source.profile?.dataset?.name, "Data Profiling Report"); return await merge([await render(browser, coverHtml(source), false, datasetName), await render(browser, tocHtml(sections), false, datasetName), await render(browser, bodyHtml(source, sections), true, datasetName), await render(browser, backCoverHtml(source), false, datasetName)]); }
  catch (error) { if (error instanceof PdfExportError) throw error; console.error("Chromium PDF rendering failed", error); throw new PdfExportError("Không thể render PDF bằng Chromium.", 503); }
  finally { activeExports -= 1; await browser?.close(); }
}
export const __test__ = { buildSections, bodyHtml, tocHtml, coverHtml, backCoverHtml, numberSections };
