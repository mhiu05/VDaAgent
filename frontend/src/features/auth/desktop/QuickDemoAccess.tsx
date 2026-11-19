import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Building2, LoaderCircle, ShieldCheck, UserRound } from "lucide-react";
import { useAuth } from "../providers/AuthProvider";
import type { DemoProfile } from "../services/auth-service";

const profiles = [
  { id: "admin", icon: ShieldCheck, badge: "ADMIN" },
  { id: "vre-demo", icon: Building2, badge: "DEMO" },
  { id: "alice", icon: UserRound, badge: "DEMO" },
] as const;

export function QuickDemoAccess() {
  const { t } = useTranslation("auth");
  const { loginDemo } = useAuth();
  const [pending, setPending] = useState<DemoProfile | null>(null);
  const [error, setError] = useState("");
  const busy = useRef(false);

  async function enter(profile: DemoProfile) {
    if (busy.current) return;
    busy.current = true;
    setPending(profile);
    setError("");
    try {
      const message = await loginDemo(profile);
      if (message) setError(message);
    } catch {
      setError("demoLoginFailed");
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  return (
    <section className="sd-quick-access" aria-labelledby="quick-access-title">
      <div className="sd-quick-heading">
        <h2 id="quick-access-title">{t("quickAccess")}</h2>
        <p>{t("quickAccessSubtitle")}</p>
      </div>
      <div className="sd-quick-list">
        {profiles.map(({ id, icon: Icon, badge }) => (
          <button key={id} className={`sd-quick-row ${id === "admin" ? "is-admin" : ""}`}
            type="button" disabled={pending !== null} aria-busy={pending === id}
            onClick={() => void enter(id)}>
            <span className="sd-quick-icon"><Icon size={20} aria-hidden="true" /></span>
            <span className="sd-quick-copy">
              <span className="sd-quick-title">{t(`demo_${id.replace("-", "_")}_title`)}<span className="sd-quick-badge">{badge}</span></span>
              <span className="sd-quick-description">{t(`demo_${id.replace("-", "_")}_description`)}</span>
              <span className="sd-quick-alias">{id}</span>
            </span>
            {pending === id ? <LoaderCircle className="sd-quick-spinner" size={18} aria-hidden="true" />
              : <ArrowRight className="sd-quick-arrow" size={18} aria-hidden="true" />}
          </button>
        ))}
      </div>
      {error && <p className="sd-quick-error" role="alert">
        {t(error === "app:demoAdminUnavailable" ? "demoAdminUnavailable" : "demoLoginFailed")}
      </p>}
    </section>
  );
}
