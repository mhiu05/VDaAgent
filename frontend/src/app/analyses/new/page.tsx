"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { createAnalysis } from "@/lib/api";
import { ErrorNotice, PageHeader } from "@/components/ui";

function NewAnalysisForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [runId, setRunId] = useState(params.get("runId") || "");
  const [goal, setGoal] = useState(""); const [mode, setMode] = useState<"quick" | "deep">("quick"); const [error, setError] = useState<Error | null>(null); const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setError(null); setSaving(true); try { const session = await createAnalysis({ profile_run_id: runId.trim(), goal: goal.trim(), mode }); router.push(`/analyses/${session.id}`); } catch (reason) { setError(reason instanceof Error ? reason : new Error("Không thể tạo analysis.")); } finally { setSaving(false); } }
  return <><PageHeader eyebrow="Step 1 of 6" title="Start analysis" description="Chọn một completed profile run; source/version sẽ được pin suốt session." />{error && <ErrorNotice error={error} />}
    <form className="panel form-stack" onSubmit={submit}><label>Profile run ID<input value={runId} onChange={(event) => setRunId(event.target.value)} required placeholder="ID từ profile report" /></label><label>Business goal<textarea value={goal} onChange={(event) => setGoal(event.target.value)} required minLength={3} placeholder="Ví dụ: Doanh thu khác nhau thế nào theo khu vực?" /></label><fieldset><legend>Mode</legend><label><input type="radio" checked={mode === "quick"} onChange={() => setMode("quick")} /> Quick Answer — một phép tính bounded</label><label><input type="radio" checked={mode === "deep"} onChange={() => setMode("deep")} /> Deep Analysis — sẽ cần plan review</label></fieldset><button className="button primary" disabled={saving}>{saving ? "Đang tạo…" : "Continue to context"}</button></form></>;
}

export default function NewAnalysisPage() {
  return <Suspense fallback={<p className="muted">Đang mở analysis intake…</p>}><NewAnalysisForm /></Suspense>;
}
