import { openDB, type DBSchema } from "idb";
import type { ChatBundle } from "../../features/chat/model/types";
import type { Attachment, Message } from "../../features/chat/model/types";
import {
  validContentBlocks,
  validReportReference,
} from "../../features/chat/model/validate-content";
interface ChatDB extends DBSchema {
  scopes: { key: string; value: ChatBundle };
}
export function isBundle(v: unknown): v is ChatBundle {
  if (!v || typeof v !== "object") return false;
  const b = v as ChatBundle;
  return (
    b.version === 2 &&
    Array.isArray(b.conversations) &&
    b.conversations.every(
      (c) =>
        !!c &&
        typeof c.id === "string" &&
        typeof c.title === "string" &&
        ["direct", "group"].includes(c.kind) &&
        Array.isArray(c.participants) &&
        c.participants.length > 0 &&
        c.participants.every((p) =>
          [
            "orchestrator",
            "data",
            "compare",
            "insight",
            "chart",
            "report",
          ].includes(p),
        ) &&
        typeof c.draft === "string" &&
        (c.scenarioId === undefined || typeof c.scenarioId === "string") &&
        (c.reportRef === undefined || validReportReference(c.reportRef)) &&
        (c.context === undefined ||
          (!!c.context &&
            typeof c.context.project === "string" &&
            typeof c.context.dataThrough === "string")) &&
        Array.isArray(c.attachments) &&
        c.attachments.every(isAttachment) &&
        Number.isFinite(Date.parse(c.updatedAt)) &&
        Array.isArray(c.messages) &&
        c.messages.every(
          (m) =>
            !!m &&
            typeof m.id === "string" &&
            typeof m.body === "string" &&
            typeof m.sequence === "number" &&
            Number.isFinite(m.sequence) &&
            validMessageParts(m) &&
            Number.isFinite(Date.parse(m.createdAt)) &&
            [
              "user",
              "orchestrator",
              "data",
              "compare",
              "insight",
              "chart",
              "report",
            ].includes(m.author) &&
            [
              "local-pending",
              "accepted",
              "responding",
              "complete",
              "send-rejected",
              "response-interrupted",
              "cancelled",
            ].includes(m.state),
        ),
    )
  );
}
function isAttachment(v: unknown): v is Attachment {
  if (!v || typeof v !== "object") return false;
  const a = v as Attachment;
  return (
    typeof a.id === "string" &&
    typeof a.name === "string" &&
    typeof a.size === "number" &&
    a.size >= 0 &&
    Number.isFinite(a.size) &&
    typeof a.type === "string" &&
    ["memory", "reattach"].includes(a.presence)
  );
}
function validMessageParts(m: Message) {
  return (
    (m.blocks === undefined || validContentBlocks(m.blocks)) &&
    (m.source === undefined ||
      ["mock_fixture", "runtime_projection"].includes(m.source)) &&
    (m.surface === undefined ||
      [
        "user",
        "agent_public_reply",
        "team_result_projection",
        "report_reference",
      ].includes(m.surface)) &&
    (m.dataThrough === undefined ||
      (typeof m.dataThrough === "string" &&
        Number.isFinite(Date.parse(m.dataThrough)))) &&
    (!m.attachments ||
      (Array.isArray(m.attachments) && m.attachments.every(isAttachment))) &&
    (!m.evidence ||
      (Array.isArray(m.evidence) &&
        m.evidence.every(
          (e) =>
            e &&
            typeof e.id === "string" &&
            typeof e.title === "string" &&
            typeof e.excerpt === "string" &&
            ["available", "missing", "restricted"].includes(e.access) &&
            (!e.url || typeof e.url === "string"),
        ))) &&
    (!m.artifact ||
      (typeof m.artifact.caption === "string" &&
        ["table", "report", "unknown"].includes(m.artifact.kind) &&
        (!m.artifact.columns ||
          (Array.isArray(m.artifact.columns) &&
            m.artifact.columns.every((v) => typeof v === "string"))) &&
        (!m.artifact.rows ||
          (Array.isArray(m.artifact.rows) &&
            m.artifact.rows.every(
              (r) => Array.isArray(r) && r.every((v) => typeof v === "string"),
            ))))) &&
    (!m.contributions ||
      (Array.isArray(m.contributions) &&
        m.contributions.every(
          (c) =>
            c &&
            typeof c.body === "string" &&
            [
              "orchestrator",
              "data",
              "compare",
              "insight",
              "chart",
              "report",
            ].includes(c.agentId),
        )))
  );
}
/** v1 retained text but had no attachment metadata. Migrate on read, then validate. */
export function migrateBundle(value: unknown): ChatBundle | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { version?: number; conversations?: unknown };
  if (raw.version === 1 && Array.isArray(raw.conversations)) {
    const migrated = {
      version: 2,
      conversations: raw.conversations.map((c) =>
        c && typeof c === "object"
          ? {
              ...c,
              attachments: [],
              draft: typeof c.draft === "string" ? c.draft : "",
            }
          : c,
      ),
    };
    return isBundle(migrated) ? migrated : null;
  }
  return isBundle(value) ? value : null;
}
export function createChatRepository(unavailable = false) {
  const memory = new Map<string, ChatBundle>();
  let degraded = unavailable;
  const db = () => {
    if (unavailable) return Promise.reject(new Error("unavailable"));
    return openDB<ChatDB>("vdaagent-demo", 2, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1)
          database.createObjectStore(
            "scopes",
          ); /* v2 keeps text, validates snapshots, and strips attachment byte presence on read. */
      },
    });
  };
  return {
    get degraded() {
      return degraded;
    },
    async read(id: string): Promise<ChatBundle | null> {
      if (memory.has(id)) return structuredClone(memory.get(id)!);
      try {
        const database = await db();
        const value: unknown = await database.get("scopes", id);
        database.close();
        const migrated = migrateBundle(value);
        if (value && !migrated) {
          degraded = true;
          return null;
        }
        if (!migrated) return null;
        const b = migrated;
        for (const c of b.conversations) {
          c.attachments = c.attachments.map((a) => ({
            ...a,
            presence: "reattach",
          }));
          for (const m of c.messages) {
            if (["responding", "local-pending", "accepted"].includes(m.state))
              m.state = "response-interrupted";
          }
        }
        memory.set(id, b);
        return structuredClone(b);
      } catch {
        degraded = true;
        return null;
      }
    },
    async write(id: string, b: ChatBundle) {
      memory.set(id, structuredClone(b));
      try {
        const database = await db();
        await database.put("scopes", structuredClone(b), id);
        database.close();
      } catch {
        degraded = true;
      }
    },
    async reset(id: string) {
      memory.delete(id);
      try {
        const database = await db();
        await database.delete("scopes", id);
        database.close();
      } catch {
        degraded = true;
      }
    },
    release(id: string) {
      memory.delete(id);
    },
  };
}
