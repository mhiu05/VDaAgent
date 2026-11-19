import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Download, File, Folder, Link2 } from "lucide-react";
import { Button } from "../../../shared/ui/button";
import { Select } from "../../../shared/ui/form";
import { Skeleton } from "../../../shared/ui/feedback";
import { formatDate } from "../../../shared/lib/format";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { MarkdownContent } from "../../chat/components/MarkdownContent";
import { fileSize, parseCsv } from "../../chat/components/AgentChatMessages";
import type { AgentBuilderService, FileContent, TreeEntry } from "../services/builder-service";
import { highlight, languageOf, viewKind } from "../model/highlight";
import { ErrorText, useLoad } from "./common";

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

function Code({ text, path }: { text: string; path: string }) {
  const language = languageOf(path);
  if (!language) return <pre className="folder-code">{text}</pre>;
  return (
    <pre className="folder-code">
      <code>{highlight(text, language).map((t, i) => t.kind ? <span key={i} className={`hl-${t.kind}`}>{t.text}</span> : t.text)}</code>
    </pre>
  );
}

function FileView({ path, content }: { path: string; content: FileContent }) {
  const { t } = useTranslation("agents");
  if (content.kind === "image") return <img className="folder-image" src={content.url} alt={path} />;
  if (content.kind === "binary")
    return (
      <p className="muted">
        {t("binary")} <a className="button button-secondary" href={content.url} download><Download size={14} />{t("downloadFile")}</a>
      </p>
    );
  const kind = viewKind(path);
  if (kind === "markdown") return <div className="folder-markdown"><MarkdownContent body={content.text} /></div>;
  if (kind === "csv") {
    const [head = [], ...rows] = parseCsv(content.text, 201);
    return (
      <div className="folder-csv">
        <span className="eyebrow">{t("csvRows")}</span>
        <table>
          <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  return <Code text={content.text} path={path} />;
}

/** The read-only folder viewer (doc 04 "Folder viewer"): tree, file view, breadcrumb, versions. */
export function FolderViewer({ service, agentId, initialAt }: { service: AgentBuilderService; agentId: string; initialAt?: string }) {
  const { t } = useTranslation(["agents", "app"]);
  const { preferences } = usePreferences();
  const [dir, setDir] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [at, setAt] = useState<string | undefined>(initialAt);
  const [diff, setDiff] = useState<string | null>(null);
  const tree = useLoad((s) => service.tree(agentId, dir, at, s), [service, agentId, dir, at]);
  const log = useLoad((s) => service.log(agentId, "", s), [service, agentId]);
  const content = useLoad(
    (s) => (file ? service.file(agentId, file, at, s) : Promise.resolve({ data: null })),
    [service, agentId, file, at],
  );
  const crumbs = dir ? dir.split("/") : [];
  const open = (entry: TreeEntry) => {
    if (entry.type === "dir") {
      if (entry.items === null) return; // .venv is collapsed
      setDir(join(dir, entry.name));
      setFile(null);
    } else setFile(join(dir, entry.name));
  };
  return (
    <div className="folder">
      <div className="row folder-bar">
        <nav className="folder-crumbs" aria-label={t("folderTree")}>
          <button type="button" onClick={() => { setDir(""); setFile(null); }}>{t("root")}</button>
          {crumbs.map((c, i) => (
            <span key={i}>
              <ChevronRight size={14} aria-hidden />
              <button type="button" onClick={() => { setDir(crumbs.slice(0, i + 1).join("/")); setFile(null); }}>{c}</button>
            </span>
          ))}
          {file ? <span><ChevronRight size={14} aria-hidden /><strong>{file.split("/").pop()}</strong></span> : null}
        </nav>
        <label className="folder-version">
          <span>{t("version")}</span>
          <Select value={at ?? ""} onChange={(e) => { setAt(e.target.value || undefined); setDiff(null); }}>
            <option value="">{t("current")}</option>
            {log.data?.map((c) => (
              <option key={c.commit} value={c.commit}>
                {c.commit.slice(0, 7)} · {formatDate(c.at, preferences.locale, preferences.timezone)} · {c.author} · {c.message.slice(0, 60)}
              </option>
            ))}
          </Select>
        </label>
        {at ? (
          <Button onClick={async () => {
            const r = await service.diff(agentId, at);
            setDiff(r.data ?? null);
          }}>{t("showDiff")}</Button>
        ) : null}
        <a className="button button-secondary" href={service.archiveUrl(agentId, dir, at)} download>
          <Download size={14} />{t("download")}
        </a>
      </div>
      <div className="folder-panes">
        <ul className="folder-tree" aria-label={t("folderTree")}>
          {tree.loading && !tree.data ? <li><Skeleton label={t("app:loading")} /></li> : null}
          {tree.data?.length === 0 ? <li className="muted">{t("emptyDir")}</li> : null}
          {tree.data?.map((e) => (
            <li key={e.name}>
              <button type="button" className={file === join(dir, e.name) ? "selected" : ""}
                      disabled={e.type === "dir" && e.items === null} title={e.items === null && e.type === "dir" ? t("collapsed") : undefined}
                      onClick={() => open(e)}>
                {e.type === "dir" ? <Folder size={15} aria-hidden /> : e.type === "symlink" ? <Link2 size={15} aria-hidden /> : <File size={15} aria-hidden />}
                <span>{e.name}</span>
                <small className="muted">
                  {e.type === "dir" ? (e.items === null ? "" : t("items", { count: e.items }))
                    : e.symlinkTarget ? `→ ${e.symlinkTarget}` : e.size !== null ? fileSize(e.size, preferences.locale) : ""}
                </small>
              </button>
            </li>
          ))}
        </ul>
        <section className="folder-view">
          <ErrorText code={tree.error ?? content.error} />
          {diff !== null ? <pre className="folder-code">{diff}</pre>
            : !file ? <p className="muted">{t("pickFile")}</p>
              : content.loading ? <Skeleton label={t("app:loading")} />
                : content.data ? <FileView path={file} content={content.data} /> : null}
        </section>
      </div>
    </div>
  );
}
