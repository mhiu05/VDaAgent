"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { createAnalysis } from "@/lib/api";
import { ErrorNotice, PageHeader } from "@/components/ui";

function NewAnalysisForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [runId, setRunId] = useState(params.get("runId") || "");
  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState<"quick" | "deep">("quick");
  const [error, setError] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const session = await createAnalysis({ profile_run_id: runId.trim(), goal: goal.trim(), mode });
      router.push(`/analyses/${session.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error("Không thể tạo analysis."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="new-analysis-page">
      <PageHeader
        eyebrow="Bước 1/6 · Tiếp nhận phân tích"
        title="Bắt đầu phân tích mới"
        description="Đặt câu hỏi kinh doanh, chọn profile run làm nguồn dữ liệu và bắt đầu một phiên phân tích có provenance rõ ràng."
      />

      {error && <ErrorNotice error={error} />}

      <div className="new-analysis-layout">
        <form className="panel new-analysis-form" onSubmit={submit}>
          <div className="new-analysis-form-header">
            <div className="new-analysis-form-icon" aria-hidden="true">✦</div>
            <div>
              <p className="eyebrow">Tóm tắt yêu cầu phân tích</p>
              <h2>Bạn muốn tìm hiểu điều gì?</h2>
              <p>Thông tin này sẽ được dùng để tạo context và quality gate ở các bước tiếp theo.</p>
            </div>
          </div>

          <div className="new-analysis-form-content">
            <div className="new-analysis-fields">
              <div className="new-analysis-field">
                <label className="new-analysis-label" htmlFor="profile-run-id">
                  <span>Profile run ID <i>*</i></span>
                  <small>Chọn một completed profile run để cố định source và version.</small>
                </label>
                <input
                  id="profile-run-id"
                  className="new-analysis-input"
                  value={runId}
                  onChange={(event) => setRunId(event.target.value)}
                  required
                  placeholder="Ví dụ: run_01HZX…"
                  autoComplete="off"
                />
              </div>

              <div className="new-analysis-field">
                <label className="new-analysis-label" htmlFor="business-goal">
                  <span>Business goal <i>*</i></span>
                  <small>Một câu hỏi cụ thể sẽ giúp kết quả dễ hành động hơn.</small>
                </label>
                <textarea
                  id="business-goal"
                  className="new-analysis-input new-analysis-goal"
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  required
                  minLength={3}
                  placeholder="Ví dụ: Doanh thu khác nhau thế nào theo khu vực và nhóm khách hàng?"
                />
                <div className="new-analysis-field-meta">
                  <span>Hãy bắt đầu bằng “Tại sao…”, “Điều gì…”, hoặc “Khác nhau thế nào…”</span>
                  <span>{goal.length} ký tự</span>
                </div>
              </div>

              <fieldset className="new-analysis-mode">
                <legend className="new-analysis-label">
                  <span>Chế độ phân tích <i>*</i></span>
                  <small>Chọn mức độ chi tiết phù hợp với câu hỏi của bạn.</small>
                </legend>
                <div className="new-analysis-mode-options">
                  <label className={`new-analysis-mode-option ${mode === "quick" ? "selected" : ""}`}>
                    <input type="radio" name="analysis-mode" value="quick" checked={mode === "quick"} onChange={() => setMode("quick")} />
                    <span className="new-analysis-radio" aria-hidden="true" />
                    <span className="new-analysis-mode-copy">
                      <strong>Quick Answer</strong>
                      <small>Một phép tính bounded, nhanh và phù hợp để kiểm tra giả thuyết.</small>
                    </span>
                    <span className="new-analysis-mode-badge">Nhanh</span>
                  </label>
                  <label className={`new-analysis-mode-option ${mode === "deep" ? "selected" : ""}`}>
                    <input type="radio" name="analysis-mode" value="deep" checked={mode === "deep"} onChange={() => setMode("deep")} />
                    <span className="new-analysis-radio" aria-hidden="true" />
                    <span className="new-analysis-mode-copy">
                      <strong>Deep Analysis</strong>
                      <small>Phân tích nhiều lớp hơn, có thể cần plan review trước khi chạy.</small>
                    </span>
                    <span className="new-analysis-mode-badge muted">Duyệt</span>
                  </label>
                </div>
              </fieldset>
            </div>

            <div className="new-analysis-form-footer">
              <p><span aria-hidden="true">🔒</span> Raw rows và PII không được đưa vào phiên phân tích.</p>
              <button className="button primary new-analysis-submit" disabled={saving}>
                {saving ? "Đang tạo…" : "Continue to context"}
                {!saving && <span aria-hidden="true">→</span>}
              </button>
            </div>
          </div>
        </form>

        <aside className="panel new-analysis-aside">
          <div className="new-analysis-aside-heading">
            <span className="new-analysis-aside-icon" aria-hidden="true">⌁</span>
            <div>
            <h2>Tiếp theo sẽ làm gì?</h2>
              <p>Quy trình 6 bước, mỗi bước đều có thể kiểm tra lại.</p>
            </div>
          </div>

          <ol className="new-analysis-steps">
            <li className="active"><span>1</span><div><strong>Tiếp nhận phân tích</strong><small>Đặt câu hỏi và chọn source</small></div></li>
            <li><span>2</span><div><strong>Context</strong><small>Xác định grain, dimensions, measures</small></div></li>
            <li><span>3</span><div><strong>Quality gate</strong><small>Kiểm tra chất lượng và guardrails</small></div></li>
            <li><span>4–6</span><div><strong>Compute · Review · Export</strong><small>Tính toán, duyệt và chia sẻ kết quả</small></div></li>
          </ol>

          <div className="new-analysis-tip">
            <span aria-hidden="true">✦</span>
            <div><strong>Gợi ý</strong><p>Một goal tốt nên nói rõ metric, nhóm so sánh và phạm vi thời gian nếu có.</p></div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function NewAnalysisPage() {
  return <Suspense fallback={<p className="muted">Đang mở bước tiếp nhận phân tích…</p>}><NewAnalysisForm /></Suspense>;
}
