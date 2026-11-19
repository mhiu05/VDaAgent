/** Folder viewer rendering (doc 04 "Rendering in the UI"): Markdown is rendered, `.py`, `.yaml`,
 * `.toml` and `.json` are highlighted by this small tokenizer, CSV shows a table preview. */
export type Language = "python" | "yaml" | "toml" | "json";
export type Token = { text: string; kind?: "comment" | "string" | "number" | "keyword" | "key" };

const EXT: Record<string, Language> = { py: "python", yaml: "yaml", yml: "yaml", toml: "toml", json: "json" };
const ext = (path: string) => path.toLowerCase().split(".").pop() ?? "";

export const languageOf = (path: string): Language | null => EXT[ext(path)] ?? null;

export function viewKind(path: string): "markdown" | "code" | "csv" | "text" {
  const e = ext(path);
  if (e === "md") return "markdown";
  if (e === "csv") return "csv";
  return languageOf(path) ? "code" : "text";
}

const KEYWORDS: Record<Language, Set<string>> = {
  python: new Set(("and as assert async await break class continue def del elif else except False finally for from "
    + "global if import in is lambda None nonlocal not or pass raise return True try while with yield").split(" ")),
  yaml: new Set(["true", "false", "null", "yes", "no"]),
  toml: new Set(["true", "false"]),
  json: new Set(["true", "false", "null"]),
};

export function highlight(text: string, language: Language): Token[] {
  const out: Token[] = [];
  const push = (t: string, kind?: Token["kind"]) => {
    if (!t) return;
    const last = out.at(-1);
    if (!kind && last && !last.kind) last.text += t;
    else out.push(kind ? { text: t, kind } : { text: t });
  };
  const comment = language === "json" ? null : /#[^\n]*/y;
  const string = language === "python" ? /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/y
    : /("(?:\\.|[^"\\\n])*"|'[^'\n]*')/y;
  const number = /\b\d+(?:\.\d+)?\b/y;
  const word = language === "yaml" || language === "toml" ? /[A-Za-z_][\w-]*/y : /[A-Za-z_]\w*/y;
  const lineKey = language === "yaml" ? /[ \t]*(?:- )?[\w.-]+:(?=\s|$)/y : language === "toml" ? /[ \t]*[\w.-]+(?=\s*=)/y : null;
  let i = 0;
  let lineStart = true;
  const at = (re: RegExp) => { re.lastIndex = i; const m = re.exec(text); return m ? m[0] : null; };
  while (i < text.length) {
    let m: string | null;
    if (lineStart && lineKey && (m = at(lineKey))) {
      const lead = m.match(/^[ \t]*(?:- )?/)![0];
      push(lead);
      push(m.slice(lead.length), "key");
      i += m.length;
    } else if (comment && (m = at(comment))) { push(m, "comment"); i += m.length; }
    else if ((m = at(string))) {
      const isKey = language === "json" && /^\s*:/.test(text.slice(i + m.length));
      push(m, isKey ? "key" : "string");
      i += m.length;
    } else if ((m = at(number))) { push(m, "number"); i += m.length; }
    else if ((m = at(word))) { push(m, KEYWORDS[language].has(m) ? "keyword" : undefined); i += m.length; }
    else { push(text[i]); i += 1; }
    lineStart = text[i - 1] === "\n";
  }
  return out;
}
