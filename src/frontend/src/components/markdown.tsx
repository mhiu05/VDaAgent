import React, { type ReactNode } from "react";

/**
 * Providers may serialize a response's content blocks as a Python-list
 * string (for example `[{"type": "text", "text": "..."}]`). Keep this
 * compatibility path at the rendering boundary so legacy insights and
 * summaries show their Markdown instead of the transport envelope.
 */
export function normalizeMarkdownText(input: string): string {
  const value = input.trim();
  if (!/^\[\s*\{\s*['"]type['"]\s*:\s*['"]text['"]/.test(value)) return input;

  const parts: string[] = [];
  const field = /['"]text['"]\s*:\s*(['"])/g;
  let match: RegExpExecArray | null;
  while ((match = field.exec(value))) {
    const quote = match[1];
    let escaped = false;
    let text = "";
    let index = field.lastIndex;
    for (; index < value.length; index += 1) {
      const character = value[index];
      if (character === quote && !escaped) break;
      if (escaped) {
        text += character === "n" ? "\n" : character === "r" ? "\r" : character === "t" ? "\t" : character;
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else {
        text += character;
      }
    }
    if (index < value.length && text.trim()) parts.push(text);
    field.lastIndex = index + 1;
  }
  return parts.length ? parts.join("\n") : input;
}

export function unescapeMarkdown(input: string): string {
  return input.replace(/\\([\\`*_{}\[\]()#+.!>|~\-])/g, "$1");
}

export function toPlainText(input: string): string {
  return unescapeMarkdown(normalizeMarkdownText(input))
    .replace(/^\s*#{1,6}\s*/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-+*]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "")
    .replace(/!\[([^\]]*)\]\([^\)\n]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^\)\n]*\)/g, "$1")
    .replace(/`{1,3}([^`\n]+)`{1,3}/g, "$1")
    .replace(/\*\*([^\n]*?)\*\*/g, "$1")
    .replace(/__([^\n]*?)__/g, "$1")
    .replace(/~~([^\n]*?)~~/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderInlineMarkdown(text: string): ReactNode {
  const cleaned = unescapeMarkdown(text).replace(/"{1,2}([^"\n]+?)"{1,2}/g, "$1");
  const tokens = cleaned.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*)/g);

  return tokens.map((token, tokenIndex) => {
    const code = token.match(/^`(.+)`$/);
    if (code) return <code key={`code-${tokenIndex}`}>{code[1]}</code>;

    const bold = token.match(/^\*\*(.+)\*\*$|^__(.+)__$/);
    if (bold) return <strong key={`strong-${tokenIndex}`}>{bold[1] || bold[2]}</strong>;

    const italic = token.match(/^\*(.+)\*$/);
    if (italic) return <em key={`italic-${tokenIndex}`}>{italic[1]}</em>;

    return token.replace(/^_(.+)_$/, "$1");
  });
}

const getCleanId = (text: string) => {
  return text.replace(/\*\*/g, "").replace(/^[#\s]+/, "").replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g, '');
};

export function MarkdownContent({ text, className = "markdown-message" }: { text: string; className?: string }) {
  const lines = normalizeMarkdownText(text).split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  let inDetailSection = false;

  while (index < lines.length) {
    const rawLine = lines[index];
    const indentation = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();

    if (!line) {
      inDetailSection = false;
      index += 1;
      continue;
    }

    if (/^#{1,3}\s+/.test(line)) {
      inDetailSection = false;
      const headingLevel = line.match(/^#{1,3}/)?.[0].length ?? 1;
      const heading = line.replace(/^#{1,3}\s*/, "");
      const headingId = `heading-${getCleanId(heading)}`;
      const Heading = headingLevel === 1 ? "h2" : headingLevel === 2 ? "h3" : "h4";
      blocks.push(
        <Heading
          id={headingId}
          className={`report-markdown-heading report-markdown-heading-${headingLevel}`}
          key={`heading-${index}`}
        >
          {renderInlineMarkdown(heading)}
        </Heading>,
      );
      index += 1;
      continue;
    }

    if (line.startsWith("|") && lines[index + 1]?.trim().startsWith("| ---")) {
      const headers = line.split("|").slice(1, -1).map((cell) => cell.trim());
      index += 2;
      const rows: string[][] = [];
      while (lines[index]?.trim().startsWith("|")) {
        rows.push(lines[index].split("|").slice(1, -1).map((cell) => cell.trim()));
        index += 1;
      }
      blocks.push(
        <div className="report-markdown-table-wrap" key={`table-${index}`}>
          <table>
            <thead><tr>{headers.map((header) => <th key={header}>{renderInlineMarkdown(header)}</th>)}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{renderInlineMarkdown(cell)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      const items: ReactNode[] = [];
      let inListDetailSection = false;
      while (lines[index]?.trim().startsWith("- ") || lines[index]?.trim().startsWith("* ")) {
        const item = lines[index].trim().slice(2);
        const isListSection = /^[^:]{1,80}:\s*$/.test(item);
        const isListDetail = inListDetailSection && /^[^:]{1,80}:\s+\S+/.test(item);
        const inlineNull = item.match(/^Null:\s+(.+)$/i);

        if (isListSection) {
          inListDetailSection = true;
          items.push(<li className="report-markdown-list-section" key={`section-${index}`}>{renderInlineMarkdown(item.slice(0, -1))}</li>);
        } else if (inlineNull) {
          // Keep the Null metric visually consistent with the other labeled
          // quality metrics, even when the LLM emits its detail inline.
          inListDetailSection = true;
          items.push(<li className="report-markdown-list-section" key={`section-${index}`}>Null</li>);
          items.push(<li className="report-markdown-list-detail" key={`detail-${index}`}>{renderInlineMarkdown(inlineNull[1])}</li>);
        } else {
          items.push(<li className={isListDetail ? "report-markdown-list-detail" : undefined} key={`item-${index}`}>{renderInlineMarkdown(item)}</li>);
          if (!isListDetail) inListDetailSection = false;
        }
        index += 1;
      }
      blocks.push(<ul key={`list-${index}`}>{items}</ul>);
      continue;
    }

    if (/^\d+[.)]\s+/.test(line) && /^\d+[.)]\s+/.test(lines[index + 1]?.trim() || "")) {
      const items: ReactNode[] = [];
      while (/^\d+[.)]\s+/.test(lines[index]?.trim() || "")) {
        const item = lines[index].trim().replace(/^\d+[.)]\s+/, "");
        items.push(<li key={`ordered-item-${index}`}>{renderInlineMarkdown(item)}</li>);
        index += 1;
      }
      blocks.push(<ol key={`ordered-list-${index}`}>{items}</ol>);
      continue;
    }

    if (/^(?:\*\*)?(?:\d+\.)+\s+/.test(line)) {
      const cleanId = getCleanId(line);
      const headingId = `heading-${cleanId}`;
      blocks.push(<h3 id={headingId} className="report-markdown-numbered-heading" key={`numbered-${index}`}>{renderInlineMarkdown(line)}</h3>);
      index += 1;
      continue;
    }

    if (line.endsWith(":")) {
      inDetailSection = true;
      blocks.push(<h3 className="report-markdown-section" key={`section-${index}`}>{renderInlineMarkdown(line.slice(0, -1))}</h3>);
      index += 1;
      continue;
    }

    const isSectionDetail = inDetailSection && /^[^:]{1,80}:\s+\S+/.test(line);
    blocks.push(
      <p className={indentation > 0 || isSectionDetail ? "report-markdown-detail" : undefined} key={`paragraph-${index}`}>
        {renderInlineMarkdown(line)}
      </p>,
    );
    index += 1;
  }

  return <div className={className}>{blocks}</div>;
}
