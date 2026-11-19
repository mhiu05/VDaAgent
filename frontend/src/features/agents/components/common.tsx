import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2, TriangleAlert, X } from "lucide-react";
import { useServices } from "../../../app/providers/ServicesProvider";
import { IconButton } from "../../../shared/ui/button";
import { InlineAlert } from "../../../shared/ui/feedback";
import type { ServiceResult } from "../../../shared/contracts/service-result";
import {
  AGENT_BUILDER_KEY, type AgentBuilderService, type BuilderJob,
} from "../services/builder-service";

export const useBuilder = () =>
  useServices().workspace[AGENT_BUILDER_KEY] as AgentBuilderService | undefined;

/** Read through a service; `reload()` reads again, aborting a pending read. */
export function useLoad<T>(read: (signal: AbortSignal) => Promise<ServiceResult<T>>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    read(controller.signal).then(
      (r) => {
        if (!controller.signal.aborted)
          setState(r.error ? { error: r.error.code, loading: false } : { data: r.data, loading: false });
      },
      () => undefined,
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}

export function ErrorText({ code }: { code: string | null | undefined }) {
  const { t } = useTranslation("agents");
  if (!code) return null;
  return <InlineAlert kind="error">{t(`error-${code}`, { defaultValue: t("error-other") })}</InlineAlert>;
}

export function useStatusText() {
  const { t } = useTranslation("agents");
  return (status: string, detail: string | null) =>
    status === "busy" ? t("busy") : status === "routine" ? t("routine", { name: detail ?? "" })
      : status === "compacting" ? t("compacting") : t("idle");
}

type Tracked = BuilderJob & { onDone?: (job: BuilderJob) => void };
const JobsContext = createContext<(jobId: string, kind: string, onDone?: (job: BuilderJob) => void) => void>(() => undefined);
export const useTrackJob = () => useContext(JobsContext);

/** Progress toasts for builder jobs, following `builder.job` (doc 14 "Job progress"). A job is
 * also read when tracked and periodically until terminal, since SSE has no replay. */
export function JobToasts({ service, children }: { service: AgentBuilderService; children: ReactNode }) {
  const { t } = useTranslation("agents");
  const [jobs, setJobs] = useState<Tracked[]>([]);
  const callbacks = useRef(new Map<string, (job: BuilderJob) => void>());
  const apply = useCallback((job: BuilderJob) => {
    setJobs((all) => all.some((j) => j.id === job.id)
      ? all.map((j) => (j.id === job.id && j.status !== "done" && j.status !== "failed"
        ? { ...j, ...job, output: job.output || j.output } : j)) : all);
    if (job.status === "done" || job.status === "failed") {
      const done = callbacks.current.get(job.id);
      callbacks.current.delete(job.id);
      done?.(job);
    }
  }, []);
  useEffect(() => service.onJob(apply), [service, apply]);
  useEffect(() => {
    const active = jobs.filter((job) => job.status === "queued" || job.status === "running");
    if (!active.length) return;
    const controller = new AbortController();
    let reading = false;
    const timer = window.setInterval(async () => {
      if (reading) return;
      reading = true;
      try {
        await Promise.all(active.map(async (job) => {
          const result = await service.job(job.id, controller.signal);
          if (!controller.signal.aborted && result.data) apply(result.data);
        }));
      } catch {
        // Cancellation or a transient transport failure: the next poll reconciles again.
      } finally { reading = false; }
    }, 2000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [jobs, service, apply]);
  const track = useCallback((jobId: string, kind: string, onDone?: (job: BuilderJob) => void) => {
    if (onDone) callbacks.current.set(jobId, onDone);
    setJobs((all) => [...all.filter((j) => j.id !== jobId), { id: jobId, agentId: null, kind, status: "queued", output: "" }]);
    void service.job(jobId).then((r) => { if (r.data) apply(r.data); });
  }, [service, apply]);
  return (
    <JobsContext.Provider value={track}>
      {children}
      <div className="builder-toasts" aria-live="polite">
        {jobs.map((j) => {
          const kind = t(`job-${j.kind}`, { defaultValue: j.kind });
          const label = j.status === "done" ? t("jobDone", { kind }) : j.status === "failed"
            ? t("jobFailed", { kind }) : j.status === "running" ? t("jobRunning", { kind }) : t("jobQueued", { kind });
          return (
            <div key={j.id} className={`builder-toast builder-toast-${j.status}`} role="status">
              {j.status === "done" ? <CheckCircle2 size={18} /> : j.status === "failed"
                ? <TriangleAlert size={18} /> : <Loader2 size={18} className="spin" />}
              <div>
                <strong>{label}</strong>
                {j.status === "failed" && j.output ? <pre>{j.output.slice(-500)}</pre> : null}
              </div>
              {j.status === "done" || j.status === "failed" ? (
                <IconButton label={t("dismiss")} onClick={() => setJobs((all) => all.filter((x) => x.id !== j.id))}>
                  <X size={14} />
                </IconButton>
              ) : null}
            </div>
          );
        })}
      </div>
    </JobsContext.Provider>
  );
}
