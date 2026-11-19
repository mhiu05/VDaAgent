import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CornerDownRight,
  Sparkles,
} from "lucide-react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { agentRoles, reportPreview } from "./preview-model";
import { DesktopIcon } from "./DesktopIcon";
import type { WindowId } from "./window-state";

export function WorkspacePreview({ openReport }: { openReport(): void }) {
  const { t } = useTranslation("auth");
  const [selected, setSelected] = useState<(typeof agentRoles)[number]>(
    agentRoles[0],
  );
  return (
    <div className="sd-workspace-preview">
      <div className="sd-preview-meta">
        <span>
          <i /> {t("desktop_preview")}
        </span>
        <span>06 AGENTS / 01 TEAM</span>
      </div>
      <div className="sd-sample-question">
        <span>{t("desktop_sampleQuestion")}</span>
        <p>{t("desktop_question")}</p>
      </div>
      <div className="sd-agent-network">
        <svg
          className="sd-network-lines"
          viewBox="0 0 480 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M40 48 C80 48 72 24 120 24 S180 75 200 48 S260 24 280 48 S340 75 360 48 S410 24 440 48" />
          <path
            className="sd-network-signal"
            d="M40 48 C80 48 72 24 120 24 S180 75 200 48 S260 24 280 48 S340 75 360 48 S410 24 440 48"
          />
        </svg>
        {agentRoles.map((agent) => (
          <button
            type="button"
            key={agent.id}
            className={`sd-agent sd-agent-${agent.id}`}
            aria-pressed={selected.id === agent.id}
            onClick={() => setSelected(agent)}
            title={t(`desktop_${agent.description}`)}
          >
            <span className="sd-agent-node">{agent.symbol}</span>
            <span>{agent.name}</span>
          </button>
        ))}
      </div>
      <p className="sd-agent-description" aria-live="polite">
        <strong>{selected.name}</strong>
        <span>{t(`desktop_${selected.description}`)}</span>
      </p>
      <div className="sd-workspace-result">
        <CornerDownRight size={17} />
        <span>{t("desktop_result")}</span>
        <button
          type="button"
          onClick={openReport}
          aria-label={t("desktop_viewReport")}
        >
          <ArrowUpRight size={17} />
        </button>
      </div>
      <p className="sd-flow-note">{t("desktop_flowNote")}</p>
    </div>
  );
}

export function ReportPreview({
  signIn,
  open,
}: {
  signIn(): void;
  open: boolean;
}) {
  const { t, i18n } = useTranslation("auth");
  const { reducedMotion } = usePreferences();
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (!open || reducedMotion) return;
      gsap.from(".sd-chart-bar", {
        scaleX: 0,
        transformOrigin: "left",
        stagger: 0.09,
        duration: 0.7,
        ease: "power3.out",
        delay: 0.3,
      });
    },
    { scope: root, dependencies: [open, reducedMotion], revertOnUpdate: true },
  );
  const format = (value: number) =>
    value.toLocaleString(i18n.language === "vi" ? "vi-VN" : "en-US", {
      maximumFractionDigits: 1,
    });
  return (
    <div ref={root} className="sd-report-preview">
      <div className="sd-preview-meta">
        <span>{t("desktop_demo")}</span>
        <code>{reportPreview.version}</code>
      </div>
      <h2>{t("desktop_reportTitle")}</h2>
      <div className="sd-report-summary">
        <div>
          <span>{t("desktop_available")}</span>
          <strong>
            {reportPreview.available}
            <small>{t("desktop_units")}</small>
          </strong>
        </div>
        <div>
          <span>{t("desktop_aging")}</span>
          <strong>
            {format(reportPreview.agingRate)}
            <small>%</small>
          </strong>
        </div>
      </div>
      <p className="sd-denominator">{t("desktop_validAge")}</p>
      <div
        className="sd-mini-chart"
        role="img"
        aria-label={`${t("desktop_distribution")}: ${reportPreview.buckets.map((b) => `${b.label}: ${b.value}`).join(", ")}`}
      >
        {reportPreview.buckets.map((bucket, index) => (
          <div key={bucket.label}>
            <span>{["0–89", "90–179", "180–359", "360+", "?"][index]}</span>
            <i>
              <b
                className="sd-chart-bar"
                style={{ width: `${(bucket.value / 24) * 100}%` }}
              />
            </i>
            <strong>{bucket.value}</strong>
          </div>
        ))}
      </div>
      <div className="sd-report-footer">
        <span>
          <Check size={12} /> {t("desktop_reportDate")}
        </span>
        <button
          type="button"
          onClick={signIn}
          aria-label={t("desktop_readMore")}
        >
          <ArrowUpRight size={17} />
        </button>
      </div>
    </div>
  );
}

export function CapabilityPreview({
  id,
  signIn,
}: {
  id: Exclude<WindowId, "login" | "workspace" | "reports">;
  signIn(): void;
}) {
  const { t } = useTranslation("auth");
  return (
    <div className="sd-capability-preview">
      <span className="sd-kicker">{t("desktop_preview")}</span>
      <DesktopIcon id={id} />
      <h2>{t(`desktop_${id}Title`)}</h2>
      <p>{t(`desktop_${id}Body`)}</p>
      <div className="sd-capability-line">
        <Sparkles size={16} />
        <span>{t("desktop_privateNote")}</span>
      </div>
      <button type="button" className="sd-text-link" onClick={signIn}>
        {t("desktop_signIn")}
        <ArrowRight size={16} />
      </button>
    </div>
  );
}
