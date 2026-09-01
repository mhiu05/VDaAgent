import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatAnswer } from "./chat-answer";

const source = {
  type: "tool" as const,
  citation_id: "S1",
  tool: "get_profile_overview",
  args: {},
  status: "ok",
  profile_run_id: "run-1",
};

describe("ChatAnswer", () => {
  afterEach(cleanup);

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("renders server-authored findings, trust signals, and claim citations", () => {
    render(<ChatAnswer
      message={{
        id: "agent", role: "agent", text: "There are 10 rows. [S1]", sources: [source],
        answerEnvelope: {
          schema_version: "v2", summary: "There are 10 rows. [S1]",
          findings: [{ text: "There are 10 rows. [S1]", citations: [{ citation_id: "S1", source_type: "tool", metric: "row_count", value: 10, unit: "rows" }] }],
          limitations: [], actions: [], evidence_status: "verified", is_approximate: false,
          provenance: { profile_run_id: "run-1", scan_mode: "full", agent_run_id: "agent-run-1" },
        },
      }}
      fallback={<p>Legacy answer</p>}
    />);

    expect(screen.getByText("Conclusion")).toBeTruthy();
    expect(screen.getByText("Key findings")).toBeTruthy();
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.getByText("Bằng chứng và cách kết luận")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Open evidence S1" }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.getAllByText("Profile Run: run-1")).toHaveLength(1);
  });

  it("does not render a stray zero when an answer has no sources or follow-up details", () => {
    const { container } = render(<ChatAnswer
      message={{
        id: "no-extra-details", role: "agent", text: "The result is ready.",
        answerEnvelope: {
          schema_version: "v2", summary: "The result is ready.", findings: [],
          limitations: [], actions: [], evidence_status: "profile_only", is_approximate: false,
          provenance: { profile_run_id: "run-1" },
        },
      }}
      fallback={<p>Legacy answer</p>}
    />);

    expect(container.querySelector(".chat-answer")?.textContent).not.toMatch(/(?:^|\s)0(?:\s|$)/);
  });

  it("shows the streamed answer when a partial V2 envelope has no summary", () => {
    render(<ChatAnswer
      message={{
        id: "streamed-summary", role: "agent", text: "North has the highest count.",
        answerEnvelope: {
          schema_version: "v2", summary: null, findings: [], limitations: [], actions: [],
          evidence_status: "profile_only", is_approximate: false, provenance: {},
        },
      }}
      fallback={<p>Legacy answer</p>}
    />);

    expect(screen.getByText("North has the highest count.")).toBeTruthy();
  });

  it("removes Markdown markers from structured answer text", () => {
    const { container } = render(<ChatAnswer
      message={{
        id: "formatted", role: "agent", text: "## **There are 10 rows**",
        answerEnvelope: {
          schema_version: "v2", summary: "## **There are 10 rows**",
          findings: [{ text: "\\*\\*Rows are complete\\*\\* [S1]", citations: [] }],
          limitations: ["**No limitations**"], actions: ["`Review` the result"],
          evidence_status: "verified", is_approximate: false, provenance: {},
        },
      }}
      fallback={<p>Legacy answer</p>}
    />);

    const answerText = container.querySelector(".chat-answer")?.textContent || "";
    expect(answerText).toContain("There are 10 rows");
    expect(answerText).toContain("Rows are complete");
    expect(answerText).not.toMatch(/##|\\?\*\*/);
  });

  it("uses the legacy fallback and clearly presents insufficient evidence", () => {
    const { rerender } = render(<ChatAnswer message={{ id: "legacy", role: "agent", text: "Legacy", sources: [source], evidenceStatus: "profile_only" }} fallback={<p>Legacy answer</p>} />);
    expect(screen.getByText("Legacy answer")).toBeTruthy();
    expect(screen.getByText("Profile-based")).toBeTruthy();

    rerender(<ChatAnswer
      message={{
        id: "abstain", role: "agent", text: "I cannot conclude safely.",
        answerEnvelope: {
          schema_version: "v2", summary: "I cannot conclude safely.", findings: [],
          limitations: ["No approved evidence exists."], actions: ["Run the deterministic check."],
          evidence_status: "no_evidence", is_approximate: false, provenance: { profile_run_id: "run-1" },
        },
      }}
      fallback={<p>Legacy answer</p>}
    />);
    expect(screen.getByText("Insufficient evidence")).toBeTruthy();
    expect(screen.getByText("What is missing and what to do next")).toBeTruthy();
    expect(screen.getByText("Run the deterministic check.")).toBeTruthy();
  });

  it("keeps answer provenance immutable when the surrounding conversation context changes", () => {
    const { rerender } = render(<ChatAnswer
      message={{
        id: "historical", role: "agent", text: "July answer. [S1]", context: { datasetName: "August revenue", profileRunId: "run-aug" },
        answerEnvelope: {
          schema_version: "v2", summary: "July answer. [S1]", findings: [], limitations: [], actions: [],
          evidence_status: "verified", is_approximate: false,
          provenance: { dataset_name: "July revenue", profile_run_id: "run-july", profile_run_label: "July full scan", row_scope: "full", profiled_at: "2026-07-31T00:00:00Z" },
        },
      }}
      fallback={<p>Legacy answer</p>}
    />);

    expect(screen.getByText("Phạm vi dữ liệu: July revenue · Profile Run July full scan · full scope.")).toBeTruthy();
    expect(screen.queryByText(/August revenue/)).toBeNull();
    expect(screen.queryByText("Answer context")).toBeNull();

    rerender(<ChatAnswer
      message={{
        id: "historical", role: "agent", text: "July answer. [S1]", context: { datasetName: "September revenue", profileRunId: "run-sep" },
        answerEnvelope: {
          schema_version: "v2", summary: "July answer. [S1]", findings: [], limitations: [], actions: [],
          evidence_status: "verified", is_approximate: false,
          provenance: { dataset_name: "July revenue", profile_run_id: "run-july", profile_run_label: "July full scan", row_scope: "full" },
        },
      }}
      fallback={<p>Legacy answer</p>}
    />);

    expect(screen.getByText("Phạm vi dữ liệu: July revenue · Profile Run July full scan · full scope.")).toBeTruthy();
    expect(screen.queryByText(/September revenue/)).toBeNull();
  });
});
