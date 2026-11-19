import type { Epoch, JevDecision, TraceEvent } from "../services/admin-service";

/** The chat-trace timeline (doc 13 "Chat-trace view"), built from `events` in `seq` order. */
export interface InputBlock {
  tag: string;
  attrs: Record<string, string>;
  body: string;
  jev?: JevDecision;
}

export type TimelineRow =
  | { type: "activation"; traceId: string | null; kind: string | null; taskId: number | null; startedAt: string;
      durationMs: number; tokens: number; cost: number }
  | { type: "input"; seq: number; state: string | null; blocks: InputBlock[] }
  | { type: "reasoning"; seq: number; text: string }
  | { type: "call"; seq: number; id: string; code: string; sends: ("user" | "agent")[]; endsTask: boolean;
      result: { text: string; exitCode: number | null; durationMs: number | null;
        changed: { path: string; status: string }[];
        head: string | null; offloadPath: string | null; timedOut: boolean } | null }
  | { type: "epoch"; epoch: Epoch }
  | { type: "error"; seq: number; code: string; text: string };

const ATTR = /([\w-]+)="([^"]*)"/g;
const BLOCK = /<(message|notification|notice|begin_task|routine|restart|builder|system)\b([^>]*)>([\s\S]*?)<\/\1>/g;

export function parseInput(text: string): { state: string | null; blocks: InputBlock[] } {
  const stateMatch = text.match(/<current_state>\n?([\s\S]*?)\n?<\/current_state>/);
  const rest = stateMatch ? text.replace(stateMatch[0], "") : text;
  const blocks: InputBlock[] = [];
  for (const m of rest.matchAll(BLOCK)) {
    const attrs: Record<string, string> = {};
    for (const a of m[2].matchAll(ATTR)) attrs[a[1]] = a[2];
    blocks.push({ tag: m[1], attrs, body: m[3].trim() });
  }
  if (!blocks.length && rest.trim()) blocks.push({ tag: "text", attrs: {}, body: rest.trim() });
  return { state: stateMatch ? stateMatch[1].trim() : null, blocks };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : null);

/** execd's snapshot entries are `{path, status}` objects (`A`/`M`/`D`/`R`), never strings. */
function changedFiles(raw: unknown): { path: string; status: string }[] {
  const out: { path: string; status: string }[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (entry && typeof entry === "object" && "path" in entry)
      out.push({ path: str(entry.path), status: "status" in entry ? str(entry.status) : "" });
  }
  return out;
}

export function buildTimeline(events: readonly TraceEvent[], epochs: readonly Epoch[], jev: readonly JevDecision[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const jevByMessage = new Map(jev.map((j) => [j.messageId, j]));
  const results = new Map<string, TraceEvent>();
  for (const e of events) if (e.kind === "tool_result") results.set(str(e.payload.tool_call_id), e);
  const pendingEpochs = [...epochs].filter((e) => e.startSeq > 0).sort((a, b) => a.startSeq - b.startSeq);
  let activation: Extract<TimelineRow, { type: "activation" }> | null = null;
  let previousTrace: string | null | undefined;
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    while (pendingEpochs.length && pendingEpochs[0].startSeq <= e.seq) rows.push({ type: "epoch", epoch: pendingEpochs.shift()! });
    if (e.traceId !== previousTrace) {
      activation = { type: "activation", traceId: e.traceId, kind: e.activationKind, taskId: e.taskId,
        startedAt: e.createdAt, durationMs: 0, tokens: 0, cost: 0 };
      rows.push(activation);
      previousTrace = e.traceId;
    }
    if (activation) activation.durationMs = Date.parse(e.createdAt) - Date.parse(activation.startedAt);
    if (e.kind === "input") {
      const parsed = parseInput(str(e.payload.text));
      rows.push({ type: "input", seq: e.seq, state: parsed.state, blocks: parsed.blocks.map((b) => {
        // a lead sees a user message as <message>, <notification message=…> or <begin_task source_message=…>
        const ref = b.tag === "message" ? b.attrs.id : b.attrs.message ?? b.attrs.source_message;
        const decision = ref?.startsWith("m_") && jevByMessage.get(Number(ref.slice(2)));
        return decision ? { ...b, jev: decision } : b;
      }) });
    } else if (e.kind === "assistant") {
      const usage = (e.payload.usage ?? {}) as Record<string, unknown>;
      if (activation) {
        activation.tokens += (num(usage.prompt_tokens) ?? 0) + (num(usage.completion_tokens) ?? 0);
        activation.cost += num(usage.cost) ?? 0;
      }
      if (str(e.payload.text).trim()) rows.push({ type: "reasoning", seq: e.seq, text: str(e.payload.text) });
      for (const call of (e.payload.tool_calls ?? []) as { id: string; code: string }[]) {
        const r = results.get(call.id);
        const sends: ("user" | "agent")[] = [];
        if (/send_to_user\s*\(/.test(call.code)) sends.push("user");
        if (/send_to_agent\s*\(/.test(call.code)) sends.push("agent");
        rows.push({ type: "call", seq: e.seq, id: call.id, code: call.code, sends, endsTask: /end_task\s*\(/.test(call.code),
          result: r ? { text: str(r.payload.text), exitCode: num(r.payload.exit_code), durationMs: num(r.payload.duration_ms),
            changed: changedFiles(r.payload.changed), head: str(r.payload.head) || null,
            offloadPath: str(r.payload.offload_path) || null, timedOut: r.payload.timed_out === true } : null });
      }
    } else if (e.kind === "error") {
      rows.push({ type: "error", seq: e.seq, code: str(e.payload.code), text: str(e.payload.text) });
    }
  }
  for (const epoch of pendingEpochs) rows.push({ type: "epoch", epoch });
  for (const row of rows) if (row.type === "activation") row.cost = Math.round(row.cost * 1e6) / 1e6;
  return rows;
}
