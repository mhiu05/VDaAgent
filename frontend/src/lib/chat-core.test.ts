import { describe, expect, it } from "vitest";
import { chatHistory, chatMessagePatch, initialChatStream, reduceChatStream } from "./chat-core";

describe("shared chat stream reducer", () => {
  it("deduplicates replayed events and retains a verified answer envelope", () => {
    const requestId = "request-123";
    let state = initialChatStream(requestId);
    state = reduceChatStream(state, {
      id: "1",
      event: "status",
      data: { schema_version: "chat_stream.v1", request_id: requestId, stage: "running_tool", detail: "Running calculation" },
    });
    state = reduceChatStream(state, {
      id: "2",
      event: "token",
      data: { schema_version: "chat_stream.v1", request_id: requestId, text: "There are 10 rows. [S1]" },
    });
    state = reduceChatStream(state, {
      id: "2",
      event: "token",
      data: { schema_version: "chat_stream.v1", request_id: requestId, text: "There are 10 rows. [S1]" },
    });
    state = reduceChatStream(state, {
      id: "3",
      event: "done",
      data: {
        schema_version: "chat_stream.v1",
        request_id: requestId,
        evidence_status: "verified",
        answer_envelope: {
          schema_version: "v2",
          summary: "There are 10 rows. [S1]",
          findings: [{ text: "There are 10 rows. [S1]", citations: [{ citation_id: "S1", source_type: "tool", metric: "row_count", value: 10, unit: "rows" }] }],
          limitations: [],
          actions: [],
          evidence_status: "verified",
          is_approximate: false,
          provenance: { profile_run_id: "run-1", agent_run_id: "agent-1" },
        },
      },
    });

    expect(state.text).toBe("There are 10 rows. [S1]");
    expect(state.lifecycle).toBe("completed");
    expect(chatMessagePatch(state)).toMatchObject({ requestId, evidenceStatus: "verified", agentRunId: "agent-1" });
    expect(state.answerEnvelope?.findings[0].citations[0].value).toBe(10);
  });

  it("keeps no-evidence and cancellation states distinct", () => {
    const noEvidence = reduceChatStream(initialChatStream("no-evidence"), {
      id: "1",
      event: "done",
      data: {
        request_id: "no-evidence",
        answer_envelope: {
          schema_version: "v2", findings: [], limitations: ["No evidence"], actions: ["Run profiling"],
          evidence_status: "no_evidence", is_approximate: false, provenance: {},
        },
      },
    });
    const cancelled = reduceChatStream(initialChatStream("cancelled"), {
      id: "1", event: "error", data: { request_id: "cancelled", state: "cancelled", detail: "Request stopped" },
    });

    expect(noEvidence.lifecycle).toBe("no_evidence");
    expect(chatMessagePatch(noEvidence).status).toBeUndefined();
    expect(cancelled.lifecycle).toBe("cancelled");
    expect(chatMessagePatch(cancelled).status).toBe("cancelled");
  });

  it("does not persist blank in-flight placeholders in history", () => {
    expect(chatHistory([
      { id: "1", role: "user", text: "Question" },
      { id: "2", role: "agent", text: "", status: "streaming" },
      { id: "3", role: "agent", text: "Answer" },
    ])).toEqual([{ role: "user", text: "Question" }, { role: "agent", text: "Answer" }]);
  });
});
