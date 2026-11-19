import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Download, FileText, Paperclip, Pencil, SendHorizontal, Square, X } from "lucide-react";
import { Button, IconButton } from "../../../shared/ui/button";
import { Dialog } from "../../../shared/ui/overlay";
import { InlineAlert, useFeedback } from "../../../shared/ui/feedback";
import { formatDate, formatNumber } from "../../../shared/lib/format";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { MarkdownContent } from "./MarkdownContent";
import { ReportReferenceCard } from "./ReportReferenceCard";
import { AgentFace } from "./AgentChatList";
import { choiceState } from "../model/agent-chat-state";
import {
  ATTACHMENT_LIMITS, type ChatAttachment, type ChatChoice, type ChatMessage, type ChatTask,
} from "../services/agent-chat-service";

const CSV_PREVIEW_ROWS = 50;
const CSV_PREVIEW_BYTES = 2 * 1024 * 1024;

export function parseCsv(text: string, maxRows: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if ((cell || row.length) && rows.length < maxRows) { row.push(cell); rows.push(row); }
  return rows;
}

export function fileSize(bytes: number, locale: "vi" | "en") {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, locale, { maximumFractionDigits: 1 })} KB`;
  return `${formatNumber(bytes / 1024 / 1024, locale, { maximumFractionDigits: 1 })} MB`;
}

function CsvPreview({ attachment }: { attachment: ChatAttachment }) {
  const { t } = useTranslation("chat");
  const [rows, setRows] = useState<string[][] | null>(null);
  useEffect(() => {
    if (attachment.size > CSV_PREVIEW_BYTES || typeof fetch !== "function") return;
    const controller = new AbortController();
    fetch(attachment.url, { credentials: "include", signal: controller.signal })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => setRows(parseCsv(text, CSV_PREVIEW_ROWS + 1)))
      .catch(() => undefined);
    return () => controller.abort();
  }, [attachment.url, attachment.size]);
  if (!rows?.length) return null;
  const [head, ...body] = rows;
  return (
    <div className="ac-csv">
      <span className="eyebrow">{t("acCsvRows")}</span>
      <div className="ac-csv-scroll">
        <table>
          <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
          <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function AttachmentView({ attachment, onOpen }: { attachment: ChatAttachment; onOpen(attachment: ChatAttachment): void }) {
  const { t } = useTranslation("chat");
  const { preferences } = usePreferences();
  if (attachment.mime.startsWith("image/"))
    return (
      <button className="ac-image" type="button" onClick={() => onOpen(attachment)}
         aria-label={t("acOpenDocument", { name: attachment.filename })}>
        <img src={attachment.url} alt={attachment.filename} loading="lazy" />
      </button>
    );
  const csv = attachment.mime === "text/csv" || attachment.filename.toLowerCase().endsWith(".csv");
  return (
    <div className="ac-file">
      <div className="ac-file-card">
        <button className="ac-file-open" type="button" aria-label={t("acOpenDocument", { name: attachment.filename })} onClick={() => onOpen(attachment)}>
          <FileText size={20} aria-hidden />
          <span className="ac-file-name">{attachment.filename}</span>
          <span className="muted">{fileSize(attachment.size, preferences.locale)}</span>
        </button>
        <a className="button button-ghost" href={attachment.url} download={attachment.filename}>
          <Download size={15} />{t("acDownload")}
        </a>
      </div>
      {csv ? <CsvPreview attachment={attachment} /> : null}
    </div>
  );
}

export function MessageItem({ message, messages, group, currentUserId, onChoose, onOpenAttachment, onEdit, disabled }: {
  message: ChatMessage; messages: readonly ChatMessage[]; group: boolean;
  currentUserId?: string;
  onChoose(message: ChatMessage, choice: ChatChoice): void;
  onOpenAttachment(attachment: ChatAttachment): void;
  /** Browser-local edit; omitted in group rooms, whose messages are shared. */
  onEdit?(message: ChatMessage, text: string): void;
  disabled: boolean;
}) {
  const { t } = useTranslation(["chat", "app"]);
  const notify = useFeedback();
  const { preferences } = usePreferences();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.text);
  const [copied, setCopied] = useState(false);
  const time = formatDate(message.createdAt, preferences.locale, preferences.timezone, { timeStyle: "short" });
  if (message.sender.type === "system")
    return <p className="ac-system" data-message-id={message.id}>{message.text}</p>;
  const user = message.sender.type === "user" && (!currentUserId || message.sender.id === currentUserId);
  // Editing needs a known author: only the current user's own message, and only where offered.
  const editable = Boolean(onEdit) && message.sender.type === "user"
    && currentUserId !== undefined && message.sender.id === currentUserId;
  const choices = choiceState(message, messages);
  return (
    <article className={`ac-message ${user ? "ac-mine" : ""}`} data-message-id={message.id}>
      {!user ? <AgentFace name={message.sender.name} identity={message.sender.id ?? message.sender.name} avatar={message.sender.avatar} size={30} /> : null}
      <div className="ac-bubble-wrap">
        {!user && group ? <strong className="ac-sender-name">{message.sender.name}</strong> : null}
        {message.target === "lead" ? (
          <span className="badge ac-ai-badge">{message.mention ? `Hỏi AI · ${message.mention.name}` : "Hỏi AI"}</span>
        ) : null}
        {message.text ? (
          <div className="ac-bubble">
            {editing ? (
              <form className="ac-message-edit" onSubmit={(event) => {
                event.preventDefault();
                const text = draft.trim();
                if (!text || !onEdit) return;
                onEdit(message, text);
                setEditing(false);
              }}>
                <label className="sr-only" htmlFor={`ac-edit-${message.id}`}>{t("acEditMessage")}</label>
                <textarea id={`ac-edit-${message.id}`} value={draft} rows={3} maxLength={20000}
                  onChange={(event) => setDraft(event.target.value)} autoFocus />
                <div>
                  <IconButton label={t("acCancelEdit")} type="button" onClick={() => { setDraft(message.text); setEditing(false); }}><X size={15} /></IconButton>
                  <IconButton label={t("acSaveEdit")} type="submit" variant="primary" disabled={!draft.trim()}><Check size={15} /></IconButton>
                </div>
              </form>
            ) : user ? <p className="user-text">{message.text}</p> : <MarkdownContent body={message.text} />}
          </div>
        ) : null}
        {message.attachments.map((a) => <AttachmentView key={a.id} attachment={a} onOpen={onOpenAttachment} />)}
        {message.reportRefs.map((r) => (
          <ReportReferenceCard key={r.versionId} reference={{ reportId: r.reportId, versionId: r.versionId }} />
        ))}
        {message.choices.length ? (
          <div className="ac-choices" role="group">
            {message.choices.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`ac-chip ${choices.chosen === c.id ? "chosen" : ""}`}
                aria-pressed={choices.chosen === c.id}
                disabled={choices.locked || disabled}
                onClick={() => onChoose(message, c)}
              >
                {c.label}
              </button>
            ))}
          </div>
        ) : null}
        {message.text && !editing ? (
          <div className="ac-message-footer">
            {user ? <time dateTime={message.createdAt}>{time}</time> : null}
            <span className="ac-message-actions">
              <IconButton label={copied ? t("acCopiedMessage") : t("acCopyMessage")} onClick={async () => {
                try {
                  await navigator.clipboard.writeText(message.text);
                  setCopied(true);
                  notify({ kind: "success", title: t("app:copied") });
                  window.setTimeout(() => setCopied(false), 1600);
                } catch {
                  notify({ kind: "error", title: t("app:copyError") });
                }
              }}>{copied ? <Check size={14} /> : <Copy size={14} />}</IconButton>
              {editable && !disabled ? <IconButton label={t("acEditMessage")} onClick={() => { setDraft(message.text); setEditing(true); }}><Pencil size={14} /></IconButton> : null}
            </span>
            {!user ? <time dateTime={message.createdAt}>{time}</time> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export type MentionAgent = { slug: string; name: string; avatar: ChatMessage["sender"]["avatar"] };

/** The `@query` being typed right before the caret, if any. */
const mentionQuery = (value: string, caret: number) => /(?:^|\s)@([^\s@]*)$/u.exec(value.slice(0, caret))?.[1];

export function ChatComposer({ disabled, disabledReason, groupStatus, mentionAgents = [], thinking = false, onStop, onSend }: {
  disabled: boolean; disabledReason?: string;
  groupStatus?: "provisioning" | "active" | "failed";
  /** The group's AI team, offered after `@` (group rooms only). */
  mentionAgents?: readonly MentionAgent[];
  thinking?: boolean;
  onStop?(): Promise<void>;
  onSend(text: string, files: File[], target?: "group" | "lead", mention?: string): Promise<string | null>;
}) {
  const { t } = useTranslation("chat");
  const { preferences } = usePreferences();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [mention, setMention] = useState<MentionAgent | null>(null);
  const [query, setQuery] = useState<string | undefined>(undefined);
  const [highlight, setHighlight] = useState(0);
  const empty = !text.trim() && files.length === 0;
  const mentionable = groupStatus === "active" && mentionAgents.length > 0;
  const options = query === undefined || !mentionable ? [] : mentionAgents.filter((a) =>
    [a.name, a.slug].some((label) => label.toLowerCase().startsWith(query.toLowerCase())));
  function edit(value: string, caret: number) {
    setText(value);
    setQuery(mentionQuery(value, caret));
    setHighlight(0);
    // removing the "@Name" token removes the routing intent with it
    if (mention && !value.includes(`@${mention.name}`)) setMention(null);
  }
  function pick(agent: MentionAgent) {
    const box = document.getElementById("ac-composer-text") as HTMLTextAreaElement | null;
    const caret = box?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@[^\s@]*$/u, `@${agent.name} `);
    setText(before + text.slice(caret));
    setMention(agent);
    setQuery(undefined);
  }
  async function submit(target?: "group" | "lead") {
    if (empty || disabled || pending) return;
    if (files.length > ATTACHMENT_LIMITS.count || files.some((f) => f.size > ATTACHMENT_LIMITS.bytes)) {
      setError("tooLarge");
      return;
    }
    setPending(true);
    // an @agent mention is an AI request, whichever button sent it
    const code = mention ? await onSend(text, files, "lead", mention.slug) : await onSend(text, files, target);
    setPending(false);
    setError(code);
    if (!code) { setText(""); setFiles([]); setMention(null); setQuery(undefined); }
  }
  return (
    <form className="ac-composer" onSubmit={(e) => { e.preventDefault(); void submit(groupStatus ? "group" : undefined); }}>
      {disabledReason ? <p className="muted">{disabledReason}</p> : null}
      {error ? <InlineAlert kind="error">{t(`acError-${error}`, { defaultValue: t("acError-other") })}</InlineAlert> : null}
      {files.length ? (
        <ul className="ac-pending-files">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <Paperclip size={13} aria-hidden />
              <span>{f.name}</span>
              <span className="muted">{fileSize(f.size, preferences.locale)}</span>
              <IconButton label={t("acRemoveFile", { name: f.name })}
                          onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}>
                <X size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}
      {options.length ? (
        <ul id="ac-mention-menu" className="ac-mention-menu" role="listbox" aria-label={t("acMentionMenu")}>
          {options.map((agent, i) => (
            <li key={agent.slug} role="option" aria-selected={i === highlight}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(agent)}>
                <AgentFace name={agent.name} identity={agent.slug} avatar={agent.avatar} size={22} />
                <span>{agent.name}</span>
                <small className="muted">@{agent.slug}</small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="ac-composer-box">
        <label className="sr-only" htmlFor="ac-composer-text">{t("composer")}</label>
        <textarea
          id="ac-composer-text"
          rows={2}
          value={text}
          disabled={disabled}
          placeholder={t("acPlaceholder")}
          maxLength={20000}
          aria-controls={options.length ? "ac-mention-menu" : undefined}
          onChange={(e) => edit(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyDown={(e) => {
            if (options.length && !e.nativeEvent.isComposing) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const step = e.key === "ArrowDown" ? 1 : options.length - 1;
                setHighlight((i) => (i + step) % options.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pick(options[Math.min(highlight, options.length - 1)]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setQuery(undefined);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit(groupStatus ? "group" : undefined);
            }
          }}
        />
        <input
          ref={input}
          type="file"
          multiple
          hidden
          aria-label={t("acAttach")}
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            setFiles((all) => [...all, ...picked]);
            e.target.value = "";
          }}
        />
        <IconButton label={t("acAttach")} disabled={disabled} onClick={() => input.current?.click()}>
          <Paperclip size={16} />
        </IconButton>
        {thinking ? (
          <IconButton
            className="ac-stop-thinking"
            label={t("acStopThinking")}
            type="button"
            variant="primary"
            disabled={!onStop}
            pending={stopping}
            onClick={async () => {
              if (!onStop) return;
              setStopping(true);
              await onStop();
              setStopping(false);
            }}
          >
            <Square size={13} fill="currentColor" />
          </IconButton>
        ) : (
          <IconButton label={t("acSend")} type="submit" variant="primary" disabled={disabled || empty} pending={pending}>
            <SendHorizontal size={16} />
          </IconButton>
        )}
      </div>
      {groupStatus ? <div className="ac-ai-action">
        <Button type="button" disabled={disabled || empty || groupStatus !== "active" || pending}
          title={groupStatus !== "active" ? "Đội AI của nhóm đang được khởi tạo" : undefined}
          onClick={() => void submit("lead")}>Hỏi AI</Button>
        {groupStatus !== "active" ? <span className="muted">Đội AI của nhóm đang được khởi tạo</span> : null}
      </div> : null}
      <p className="muted ac-hint">{t("acHint")} · {t("acLimits")}</p>
    </form>
  );
}

export function TaskBanner({ running, queued, now, onCancel }: {
  running: ChatTask | null; queued: number; now: number; onCancel(task: ChatTask): Promise<string | null>;
}) {
  const { t } = useTranslation(["chat", "app"]);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!running && queued === 0) return null;
  const started = running?.startedAt ? Date.parse(running.startedAt) : NaN;
  const minutes = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 60000)) : 0;
  return (
    <div className="ac-task" role="status">
      {running ? (
        <>
          <span className="ac-task-text">
            <strong>{t("acTask", { description: running.description })}</strong>
            <span className="muted"> · {t("acElapsed", { minutes })}</span>
          </span>
        </>
      ) : null}
      {queued ? <span className="badge">{t("acQueued", { count: queued })}</span> : null}
      {running ? <Button variant="danger" onClick={() => setConfirming(true)}>{t("acCancel")}</Button> : null}
      {error ? <span className="ac-task-error" role="alert">{t(`acError-${error}`, { defaultValue: t("acError-other") })}</span> : null}
      {running ? (
        <Dialog open={confirming} onOpenChange={setConfirming} title={t("acCancelTitle")}
                description={t("acCancelBody", { description: running.description })} closeLabel={t("app:close")}>
          <div className="row ac-dialog-actions">
            <Button onClick={() => setConfirming(false)}>{t("acKeep")}</Button>
            <Button variant="danger" pending={pending} onClick={async () => {
              setPending(true);
              const code = await onCancel(running);
              setPending(false);
              setError(code);
              setConfirming(false);
            }}>{t("acCancelConfirm")}</Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
