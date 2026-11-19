import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Paperclip, X, Square, AtSign } from "lucide-react";
import type { Agent, Attachment, Conversation } from "../model/types";
import { canUse } from "../model/types";
import { Button, IconButton } from "../../../shared/ui/button";
import { InlineAlert } from "../../../shared/ui/feedback";
export function validateFiles(files: File[], existing: number) {
  const types = [
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/pdf",
    "image/png",
    "image/jpeg",
  ];
  return (
    existing + files.length <= 5 &&
    files.every(
      (f) =>
        f.size <= 10 * 1024 * 1024 &&
        types.includes(f.type || (/\.csv$/i.test(f.name) ? "text/csv" : "")),
    )
  );
}
export function Composer({
  conversation,
  agents,
  pending,
  replay,
  offline,
  bytes,
  allocateId,
  onDraft,
  onSend,
  onCancel,
  prompt,
}: {
  conversation: Conversation;
  agents: readonly Agent[];
  pending: boolean;
  replay: boolean;
  offline: boolean;
  bytes: RefObject<Map<string, File>>;
  allocateId(prefix: string): string;
  onDraft(body: string, files: Attachment[]): void;
  onSend(body: string, files: Attachment[]): void;
  onCancel(): void;
  prompt: string;
}) {
  const { t } = useTranslation(["chat", "app"]);
  const [body, setBody] = useState(conversation.draft);
  const [files, setFiles] = useState(
    conversation.attachments.map((a) => ({
      ...a,
      presence: bytes.current.has(a.id)
        ? ("memory" as const)
        : ("reattach" as const),
    })),
  );
  const [error, setError] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [caret, setCaret] = useState(conversation.draft.length);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const agent = agents.find((a) => a.id === conversation.participants[0]);
  const attachmentsAllowed = canUse(agent?.capabilities.attachments);
  const mentionQuery = !mentionDismissed
    ? body.slice(0, caret).match(/(?:^|\s)@([^\s@]*)$/)?.[1]
    : undefined;
  const mentionAgents =
    mentionQuery !== undefined
      ? agents.filter(
          (a) =>
            conversation.participants.includes(a.id) &&
            canUse(a.capabilities.mention) &&
            a.name.toLowerCase().includes(mentionQuery.toLowerCase()),
        )
      : [];
  useEffect(() => {
    if (prompt) {
      setBody(prompt);
      setCaret(prompt.length);
      input.current?.focus();
      input.current?.setSelectionRange(prompt.length, prompt.length);
    }
  }, [prompt]);
  useLayoutEffect(() => {
    if (!input.current) return;
    input.current.style.height = "auto";
    input.current.style.height = `${Math.min(180, input.current.scrollHeight)}px`;
  }, [body]);
  const update = (next: string, nextFiles = files) => {
    setBody(next);
    setFiles(nextFiles);
    onDraft(next, nextFiles);
  };
  const send = () => {
    if (
      pending ||
      offline ||
      !body.trim() ||
      files.some((a) => a.presence === "reattach")
    )
      return;
    onSend(body, files);
  };
  function mention(name: string) {
    const prefix = body.slice(0, caret).replace(/@[^\s@]*$/, `@${name} `);
    update(prefix + body.slice(caret));
    setCaret(prefix.length);
    setMentionDismissed(true);
    setMentionIndex(0);
    input.current?.focus();
    requestAnimationFrame(() =>
      input.current?.setSelectionRange(prefix.length, prefix.length),
    );
  }
  return (
    <div className="composer-area">
      <div className="composer-box">
        {files.length > 0 && (
          <ul className="attachment-list">
            {files.map((a) => (
              <li key={a.id}>
                <Paperclip size={13} />
                <span>
                  {a.name}
                  <small>
                    {Math.ceil(a.size / 1024)} KiB ·{" "}
                    {t(a.presence === "reattach" ? "reattach" : "unuploaded")}
                  </small>
                </span>
                <IconButton
                  label={`${t("remove")}: ${a.name}`}
                  onClick={() => {
                    bytes.current.delete(a.id);
                    update(
                      body,
                      files.filter((f) => f.id !== a.id),
                    );
                  }}
                >
                  <X size={14} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <label htmlFor="chat-message" className="sr-only">
          {t("composer")}
        </label>
        <textarea
          id="chat-message"
          ref={input}
          value={body}
          placeholder={
            conversation.scenarioId
              ? t("scenarioPlaceholder")
              : t("placeholder")
          }
          rows={1}
          disabled={pending}
          onChange={(e) => {
            update(e.target.value);
            setCaret(e.target.selectionStart);
            setMentionDismissed(false);
            setMentionIndex(0);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(e) => {
            if (
              e.nativeEvent.isComposing ||
              composing.current ||
              e.nativeEvent.keyCode === 229
            )
              return;
            if (mentionAgents.length) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMentionIndex((i) => (i + 1) % mentionAgents.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setMentionIndex(
                  (i) => (i - 1 + mentionAgents.length) % mentionAgents.length,
                );
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMentionDismissed(true);
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                mention(
                  mentionAgents[mentionIndex % mentionAgents.length].name,
                );
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          aria-describedby="composer-hint"
          aria-controls={mentionAgents.length ? "mention-list" : undefined}
          aria-activedescendant={
            mentionAgents.length
              ? `mention-${mentionAgents[mentionIndex % mentionAgents.length].id}`
              : undefined
          }
          aria-autocomplete="list"
        />
        {mentionAgents.length > 0 && (
          <div
            id="mention-list"
            role="listbox"
            aria-label={t("mentions")}
            className="mention-picker"
          >
            {mentionAgents.map((a, i) => (
              <button
                type="button"
                role="option"
                id={`mention-${a.id}`}
                aria-selected={i === mentionIndex}
                key={a.id}
                onClick={() => mention(a.name)}
              >
                <AtSign size={14} />
                {a.name}
              </button>
            ))}
            <p>{t("mentionNote")}</p>
          </div>
        )}
        <div className="composer-actions">
          <div className="row">
            {attachmentsAllowed && (
              <>
                <input
                  ref={picker}
                  className="sr-only"
                  type="file"
                  multiple
                  accept=".csv,.xlsx,.pdf,.png,.jpg,.jpeg"
                  tabIndex={-1}
                  aria-label={t("attach")}
                  onChange={(e) => {
                    const chosen = Array.from(e.target.files ?? []);
                    if (!validateFiles(chosen, files.length)) {
                      setError(t("fileError"));
                      e.target.value = "";
                      return;
                    }
                    const additions = chosen.map((f) => {
                      const id = allocateId("file");
                      bytes.current.set(id, f);
                      return {
                        id,
                        name: f.name,
                        size: f.size,
                        type: f.type,
                        presence: "memory" as const,
                      };
                    });
                    update(body, [...files, ...additions]);
                    setError("");
                    e.target.value = "";
                  }}
                />
                <IconButton
                  label={t("attach")}
                  disabled={pending}
                  onClick={() => picker.current?.click()}
                >
                  <Paperclip size={18} />
                </IconButton>
              </>
            )}
            <span className="composer-agent">
              {agent?.glyph} {agent?.name}
            </span>
            {conversation.participants.some((id) =>
              canUse(agents.find((a) => a.id === id)?.capabilities.mention),
            ) ? (
              <IconButton
                label={t("mentions")}
                disabled={pending}
                onClick={() => {
                  const position = input.current?.selectionStart ?? body.length;
                  update(`${body.slice(0, position)}@${body.slice(position)}`);
                  setCaret(position + 1);
                  setMentionDismissed(false);
                  input.current?.focus();
                  requestAnimationFrame(() =>
                    input.current?.setSelectionRange(
                      position + 1,
                      position + 1,
                    ),
                  );
                }}
              >
                <AtSign size={17} />
              </IconButton>
            ) : null}
            {conversation.reportRef ? (
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  update("/report Riverside đợt 10");
                  input.current?.focus();
                }}
              >
                /report
              </Button>
            ) : null}
          </div>
          {pending && canUse(agent?.capabilities.cancel) ? (
            <Button onClick={onCancel}>
              <Square size={14} />
              {t(replay ? "cancel" : "cancelResponse")}
            </Button>
          ) : (
            <IconButton
              label={t("send")}
              variant="primary"
              disabled={
                !body.trim() ||
                pending ||
                offline ||
                files.some((a) => a.presence === "reattach")
              }
              onClick={send}
            >
              <ArrowUp size={20} />
            </IconButton>
          )}
        </div>
      </div>
      {error && <InlineAlert kind="error">{error}</InlineAlert>}
      <div className="composer-note">
        <span id="composer-hint">
          {files.length ? t("attachmentNote") : t("hint")}
        </span>
        {conversation.scenarioId ? null : <span>{t("app:demo")}</span>}
      </div>
    </div>
  );
}
