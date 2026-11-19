// The chat-trace timeline (doc 13 "Chat-trace view").
import { describe, expect, it } from "vitest";
import { buildTimeline, parseInput } from "../model/trace";
import type { TraceEvent } from "../services/admin-service";

const STATE = "<current_state>\ntime: 08:35\ntask: none\n</current_state>\n";

describe("trace timeline", () => {
  it("splits an input into the state chip and its elements", () => {
    const parsed = parseInput(`${STATE}<message id="m_7" from="user:alice" thread="direct:lead" at="08:35">\nVì sao?\n</message>\n<notice id="d_1" kind="presence" at="08:35">The user just opened the app.</notice>`);
    expect(parsed.state).toBe("time: 08:35\ntask: none");
    expect(parsed.blocks).toEqual([
      { tag: "message", attrs: { id: "m_7", from: "user:alice", thread: "direct:lead", at: "08:35" }, body: "Vì sao?" },
      { tag: "notice", attrs: { id: "d_1", kind: "presence", at: "08:35" }, body: "The user just opened the app." },
    ]);
  });

  it("keeps the message inside begin_task and falls back to plain text", () => {
    const parsed = parseInput(`${STATE}<begin_task id="T1" source_message="m_1" thread="direct:lead">\n<message id="m_1" from="user:alice">Hỏi</message>\n</begin_task>`);
    expect(parsed.blocks[0]).toMatchObject({ tag: "begin_task", attrs: { id: "T1" } });
    expect(parsed.blocks[0].body).toContain("Hỏi");
    expect(parseInput("compaction prompt").blocks).toEqual([{ tag: "text", attrs: {}, body: "compaction prompt" }]);
  });

  it("builds activations, calls with results, sends, task ends, epochs, errors and jev", () => {
    const ev = (seq: number, kind: TraceEvent["kind"], payload: Record<string, unknown>, trace = "t1"): TraceEvent => ({
      seq, epoch: seq < 6 ? 0 : 1, kind, payload, traceId: trace, activationKind: "task", taskId: 1,
      createdAt: `2026-10-18T01:00:0${seq}Z`,
    });
    const usage = { cost: 0.01, prompt_tokens: 100, completion_tokens: 10 };
    const events = [
      ev(1, "input", { text: `${STATE}<message id="m_3" from="user:alice">Hỏi</message>` }),
      ev(2, "assistant", { text: "Nghĩ", usage, tool_calls: [{ id: "c1", code: "from contoso import send_to_user, end_task\nsend_to_user('x')\nend_task('ok')" }] }),
      ev(3, "tool_result", { tool_call_id: "c1", text: "exit_code: 0", exit_code: 0, duration_ms: 500, changed: [{ path: "files/a.csv", status: "A" }], head: "abc", offload_path: null }),
      ev(4, "assistant", { text: "Xong", usage, tool_calls: [] }),
      ev(5, "error", { code: "step_limit", text: "step limit reached" }, "t2"),
    ];
    const rows = buildTimeline(events, [{ epoch: 1, startSeq: 6, reason: "compaction", summary: "tóm tắt", systemPrompt: "S", createdAt: "x" }],
      [{ id: 1, messageId: 3, label: "task", fallback: false, observed: null }]);
    expect(rows.map((r) => r.type)).toEqual(["activation", "input", "reasoning", "call", "reasoning", "activation", "error", "epoch"]);
    const activation = rows[0] as Extract<typeof rows[number], { type: "activation" }>;
    expect(activation).toMatchObject({ traceId: "t1", kind: "task", tokens: 220, cost: 0.02, durationMs: 3000 });
    const input = rows[1] as Extract<typeof rows[number], { type: "input" }>;
    expect(input.blocks[0].jev).toMatchObject({ label: "task", messageId: 3 });
    const call = rows[3] as Extract<typeof rows[number], { type: "call" }>;
    expect(call).toMatchObject({ sends: ["user"], endsTask: true, result: { exitCode: 0, durationMs: 500, changed: [{ path: "files/a.csv", status: "A" }], head: "abc" } });
    expect(rows[6]).toMatchObject({ type: "error", code: "step_limit" });
  });
});
