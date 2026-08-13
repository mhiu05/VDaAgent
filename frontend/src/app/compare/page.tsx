"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { detectDrift } from "@/lib/api";
import { formatNumber, toTitle } from "@/lib/format";
import { ErrorNotice, Notice, PageHeader } from "@/components/ui";
import type { DriftResponse } from "@/lib/types";

export default function ComparePage() {
  const [current, setCurrent] = useState("");
  const [baseline, setBaseline] = useState("");
  const [result, setResult] = useState<DriftResponse | null>(null);
  const compare = useMutation({ mutationFn: () => detectDrift(current.trim(), baseline.trim()), onSuccess: setResult });
  return <>
    <PageHeader eyebrow="Đối chiếu phiên bản" title="So sánh drift" description="So sánh hai profile run tương thích. API xác minh dataset/version trước khi tính drift." />
    <div className="grid two"><section className="panel"><div className="panel-title"><h2>Chọn profile run</h2><small>Opaque run IDs</small></div>{compare.isError && <ErrorNotice error={compare.error} />}<div className="form-grid"><div className="field"><label htmlFor="baseline-run">Baseline run</label><input id="baseline-run" value={baseline} onChange={(event) => setBaseline(event.target.value)} placeholder="profile_run_id trước đó" /></div><div className="field"><label htmlFor="current-run">Current run</label><input id="current-run" value={current} onChange={(event) => setCurrent(event.target.value)} placeholder="profile_run_id hiện tại" /></div></div><div className="form-actions"><button className="button primary" disabled={!current.trim() || !baseline.trim() || compare.isPending} onClick={() => compare.mutate()}>{compare.isPending ? "Đang so sánh…" : "So sánh drift"}</button></div></section><section className="panel"><h2>Đọc kết quả đúng cách</h2><p className="muted">Severity và chỉ số drift do backend tính. UI chỉ trình bày kết quả, không tự kết luận từ raw sample.</p><div className="chip-list"><span className="chip">PSI</span><span className="chip">Cardinality</span><span className="chip">Null rate</span><span className="chip">Distribution</span></div></section></div>
    {result && <section className="panel" style={{ marginTop: 18 }}><Notice tone={result.findings.some((finding) => finding.severity === "major") ? "warning" : "info"}><b>{result.summary}</b><p>{result.findings.length} phát hiện · baseline {result.baseline_run_id}</p></Notice>{result.findings.length ? <div className="table-wrap"><table><thead><tr><th>Cột</th><th>Drift</th><th>Severity</th><th>Giá trị</th><th>Evidence</th></tr></thead><tbody>{result.findings.map((finding, index) => <tr key={`${finding.column_name}-${index}`}><td>{finding.column_name || "Dataset"}</td><td>{toTitle(finding.drift_type)}</td><td><span className={`status status-${finding.severity === "major" ? "failed" : "pending_review"}`}>{finding.severity}</span></td><td>{finding.psi !== null && finding.psi !== undefined ? `PSI ${formatNumber(finding.psi, 3)}` : finding.metric || "—"}</td><td>{finding.detail}</td></tr>)}</tbody></table></div> : <p className="muted">Không phát hiện drift đáng báo cáo.</p>}</section>}
  </>;
}
