import { useTranslation } from "react-i18next";
import robotHero from "../../../assets/agent-robots/robot-login-hero.png";

export function LoginHero() {
  const { t } = useTranslation("auth");

  return <section className="sd-hero-column" aria-labelledby="sd-hero-title">
    <div className="sd-auth-hero">
      <div className="sd-hero-art">
        <img src={robotHero} alt={t("heroRobotAlt")} decoding="async" fetchPriority="high" />
      </div>
    </div>
    <div className="sd-hero-copy">
      <p className="sd-hero-eyebrow">{t("heroEyebrow")}</p>
      <h1 id="sd-hero-title">
        <span>{t("heroTitleLine1")}</span>
        <span>{t("heroTitleLine2")}</span>
      </h1>
      <p className="sd-hero-subtitle">{t("heroSubtitle")}</p>
      <p className="sd-hero-tagline">{t("heroTagline")}</p>
    </div>
  </section>;
}
