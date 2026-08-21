"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { detectDrift } from "@/lib/api";
import { formatNumber, toTitle } from "@/lib/format";
import { ProfileRunPicker } from "@/components/profile-run-picker";
import { ErrorNotice, Notice, PageHeader } from "@/components/ui";
import type { DriftResponse } from "@/lib/types";

export default function ComparePage() {
  const [current, setCurrent] = useState("");
  const [baseline, setBaseline] = useState("");
  const [result, setResult] = useState<DriftResponse | null>(null);
  const compare = useMutation({ mutationFn: () => detectDrift(current, baseline), onSuccess: setResult });

  return <>
    <PageHeader eyebrow="Đối chiếu phiên bản" title="So sánh drift" description="Chọn hai phiên profiling theo tên. API vẫn xác minh dataset và phiên bản trước khi tính drift." />
    <div className="grid two"><section className="panel"><div className="panel-title"><h2>Chọn profile run</h2><small>Chỉ hiển thị phiên đã hoàn tất</small></div>{compare.isError && <ErrorNotice error={compare.error} />}<div className="form-grid"><ProfileRunPicker id="baseline-run" label="Phiên baseline" value={baseline} onChange={setBaseline} excludeRunId={current} helpText="Mốc dữ liệu dùng để đối chiếu." /><ProfileRunPicker id="current-run" label="Phiên hiện tại" value={current} onChange={setCurrent} excludeRunId={baseline} helpText="Phiên cần kiểm tra thay đổi." /></div><div className="form-actions"><button className="button primary" disabled={!current || !baseline || compare.isPending} onClick={() => compare.mutate()}>{compare.isPending ? "Đang so sánh…" : "So sánh drift"}</button></div></section><section className="panel"><h2>Đọc kết quả đúng cách</h2><p className="muted">Severity và chỉ số drift do backend tính. Giao diện chỉ trình bày aggregate evidence, không tự kết luận từ raw sample.</p><div className="chip-list"><span className="chip">PSI</span><span className="chip">Cardinality</span><span className="chip">Null rate</span><span className="chip">Distribution</span></div></section></div>
    {result && <section className="panel" style={{ marginTop: 18 }}><Notice tone={result.findings.some((finding) => finding.severity === "major") ? "warning" : "info"}><b>{result.summary}</b><p>{result.findings.length} phát hiện drift được ghi nhận.</p></Notice>{result.findings.length ? <div className="table-wrap"><table><thead><tr><th>Cột</th><th>Drift</th><th>Severity</th><th>Giá trị</th><th>Evidence</th></tr></thead><tbody>{result.findings.map((finding, index) => <tr key={`${finding.column_name}-${index}`}><td>{finding.column_name || "Dataset"}</td><td>{toTitle(finding.drift_type)}</td><td><span className={`status status-${finding.severity === "major" ? "failed" : "pending_review"}`}>{finding.severity}</span></td><td>{finding.psi !== null && finding.psi !== undefined ? `PSI ${formatNumber(finding.psi, 3)}` : finding.metric || "—"}</td><td>{finding.detail}</td></tr>)}</tbody></table></div> : <p className="muted">Không phát hiện drift đáng báo cáo.</p>}</section>}
  </>;
}
