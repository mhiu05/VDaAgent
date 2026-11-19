import { useEffect, useState } from "react";
import { unzip, strFromU8, type Unzipped } from "fflate";
import { useTranslation } from "react-i18next";
import { Skeleton } from "../../../shared/ui/feedback";

export type OfficeKind = "docx" | "xlsx" | "pptx";

type OfficePreview =
  | { kind: "docx"; blocks: DocBlock[] }
  | { kind: "xlsx"; sheets: { name: string; rows: string[][] }[] }
  | { kind: "pptx"; slides: string[][] };

type DocBlock =
  | { type: "paragraph"; text: string; level: 0 | 1 | 2 | 3; list: boolean }
  | { type: "table"; rows: string[][] };

function xml(source: Uint8Array | undefined) {
  if (!source) return null;
  return new DOMParser().parseFromString(strFromU8(source), "application/xml");
}

function textNodes(element: Element, localName = "t") {
  return [...element.getElementsByTagNameNS("*", localName)]
    .map((node) => node.textContent ?? "")
    .join("")
    .trim();
}

function attribute(element: Element | undefined, localName: string) {
  return element ? [...element.attributes].find((item) => item.localName === localName)?.value ?? "" : "";
}

function docBlocks(document: XMLDocument | null): DocBlock[] {
  const body = document?.getElementsByTagNameNS("*", "body")[0];
  if (!body) return [];
  const blocks: DocBlock[] = [];
  for (const node of [...body.children]) {
    if (node.localName === "p") {
      const text = textNodes(node);
      if (!text) continue;
      const style = attribute(node.getElementsByTagNameNS("*", "pStyle")[0], "val");
      const match = style.match(/(?:heading|tiêuđề|tieude)\s*([1-6])/i);
      const level = /title|tiêuđề|tieude/i.test(style) && !match ? 1
        : match ? Math.min(Number(match[1]), 3) as 1 | 2 | 3 : 0;
      blocks.push({
        type: "paragraph",
        text,
        level,
        list: node.getElementsByTagNameNS("*", "numPr").length > 0,
      });
    } else if (node.localName === "tbl") {
      const rows = [...node.getElementsByTagNameNS("*", "tr")].map((row) =>
        [...row.getElementsByTagNameNS("*", "tc")].map((cell) => textNodes(cell)));
      if (rows.length) blocks.push({ type: "table", rows });
    }
  }
  const first = blocks[0];
  if (first?.type === "paragraph" && first.level === 0 && first.text.length <= 120)
    first.level = 1;
  return blocks;
}

function numberedFiles(files: Unzipped, expression: RegExp) {
  return Object.entries(files)
    .map(([name, value]) => ({ name, value, order: Number(name.match(expression)?.[1] ?? 0) }))
    .filter((item) => item.order > 0)
    .sort((a, b) => a.order - b.order);
}

export function parseOffice(files: Unzipped, kind: OfficeKind): OfficePreview {
  if (kind === "docx") {
    const document = xml(files["word/document.xml"]);
    return { kind, blocks: docBlocks(document) };
  }

  if (kind === "xlsx") {
    const shared = xml(files["xl/sharedStrings.xml"]);
    const strings = shared
      ? [...shared.getElementsByTagNameNS("*", "si")].map((node) => textNodes(node))
      : [];
    const workbook = xml(files["xl/workbook.xml"]);
    const names = workbook
      ? [...workbook.getElementsByTagNameNS("*", "sheet")].map((node) => node.getAttribute("name") ?? "")
      : [];
    const sheets = numberedFiles(files, /^xl\/worksheets\/sheet(\d+)\.xml$/).map((entry, index) => {
      const sheet = xml(entry.value);
      const rows = sheet
        ? [...sheet.getElementsByTagNameNS("*", "row")].slice(0, 100).map((row) =>
          [...row.getElementsByTagNameNS("*", "c")].slice(0, 30).map((cell) => {
            const cellType = cell.getAttribute("t");
            if (cellType === "inlineStr") return textNodes(cell);
            const value = cell.getElementsByTagNameNS("*", "v")[0]?.textContent ?? "";
            return cellType === "s" ? (strings[Number(value)] ?? value) : value;
          }))
        : [];
      return { name: names[index] || `Sheet ${index + 1}`, rows };
    });
    return { kind, sheets };
  }

  const slides = numberedFiles(files, /^ppt\/slides\/slide(\d+)\.xml$/).slice(0, 80).map((entry) => {
    const slide = xml(entry.value);
    return slide
      ? [...slide.getElementsByTagNameNS("*", "p")].map((node) => textNodes(node)).filter(Boolean)
      : [];
  });
  return { kind, slides };
}

function unzipOffice(data: ArrayBuffer, kind: OfficeKind) {
  const prefix = kind === "docx" ? "word/" : kind === "xlsx" ? "xl/" : "ppt/slides/";
  return new Promise<OfficePreview>((resolve, reject) => {
    unzip(new Uint8Array(data), {
      filter: (file) => file.name.endsWith(".xml") && (file.name.startsWith(prefix) || file.name === "xl/sharedStrings.xml" || file.name === "xl/workbook.xml"),
    }, (error, files) => {
      if (error) reject(error);
      else resolve(parseOffice(files, kind));
    });
  });
}

export function OfficeDocumentPreview({ url, filename, kind }: { url: string; filename: string; kind: OfficeKind }) {
  const { t } = useTranslation(["chat", "app"]);
  const [preview, setPreview] = useState<OfficePreview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setPreview(null);
    setFailed(false);
    fetch(url, { credentials: "include", signal: controller.signal })
      .then((response) => response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status))))
      .then((data) => unzipOffice(data, kind))
      .then((result) => { if (!controller.signal.aborted) setPreview(result); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [url, filename, kind]);

  if (failed) return <p className="muted ac-document-error">{t("acDocumentLoadError")}</p>;
  if (!preview) return <Skeleton label={t("app:loading")} />;

  if (preview.kind === "docx") return (
    <article className="ac-office-preview ac-office-document" aria-label={filename}>
      <header className="ac-report-masthead">
        <span>{t("acProfessionalReport")}</span>
        <strong>{filename.replace(/\.[^.]+$/, "")}</strong>
        <small>DOCX · {t("acPreviewMode")}</small>
      </header>
      <div className="ac-report-rule" />
      <div className="ac-report-body">
      {preview.blocks.length
        ? preview.blocks.map((block, index) => {
          if (block.type === "table") return (
            <div className="table-scroll ac-report-table" key={`table-${index}`}><table><tbody>
              {block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => rowIndex === 0
                ? <th key={cellIndex}>{cell}</th> : <td key={cellIndex}>{cell}</td>)}</tr>)}
            </tbody></table></div>
          );
          if (block.level === 1) return <h1 key={`${index}-${block.text}`}>{block.text}</h1>;
          if (block.level === 2) return <h2 key={`${index}-${block.text}`}>{block.text}</h2>;
          if (block.level === 3) return <h3 key={`${index}-${block.text}`}>{block.text}</h3>;
          return block.list
            ? <p className="ac-report-list" key={`${index}-${block.text}`}>{block.text}</p>
            : <p key={`${index}-${block.text.slice(0, 12)}`}>{block.text}</p>;
        })
        : <p className="muted">{t("acDocumentEmpty")}</p>}
      </div>
      <footer className="ac-report-footer"><span>VDaAgent</span><span>{t("acPreviewMode")}</span></footer>
    </article>
  );

  if (preview.kind === "xlsx") return (
    <div className="ac-office-preview ac-office-workbook" aria-label={filename}>
      {preview.sheets.map((sheet, sheetIndex) => (
        <section className="ac-office-sheet" key={`${sheetIndex}-${sheet.name}`}>
          <header><span>{t("acDataReport")}</span><h3>{sheet.name}</h3><small>XLSX · {t("acPreviewMode")}</small></header>
          <div className="table-scroll"><table><tbody>
            {sheet.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => rowIndex === 0
              ? <th key={cellIndex}>{cell}</th> : <td key={cellIndex}>{cell}</td>)}</tr>)}
          </tbody></table></div>
        </section>
      ))}
      {!preview.sheets.length ? <p className="muted">{t("acDocumentEmpty")}</p> : null}
    </div>
  );

  return (
    <div className="ac-office-preview ac-office-slides" aria-label={filename}>
      {preview.slides.map((slide, index) => (
        <article className="ac-office-slide" key={index}>
          <span>VDaAgent · {t("acSlide", { number: index + 1 })}</span>
          {slide.map((line, lineIndex) => lineIndex === 0
            ? <h3 key={`${lineIndex}-${line}`}>{line}</h3>
            : <p className="ac-slide-point" key={`${lineIndex}-${line}`}>{line}</p>)}
          <small>{String(index + 1).padStart(2, "0")}</small>
        </article>
      ))}
      {!preview.slides.length ? <p className="muted">{t("acDocumentEmpty")}</p> : null}
    </div>
  );
}
