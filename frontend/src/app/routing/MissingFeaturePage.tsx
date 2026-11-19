import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Network } from "lucide-react";
import { PageFrame } from "../../shared/ui/page";
import { useAuth } from "../../features/auth/providers/AuthProvider";
export default function MissingFeaturePage() {
  const { t } = useTranslation();
  const { snapshot } = useAuth();
  return (
    <PageFrame title={t("missingTitle")}>
      <div
        style={{ borderTop: "1px solid var(--border)", paddingTop: 32 }}
        className="stack"
      >
        <Network size={40} color="var(--primary)" />
        <p className="muted">{t("missing")}</p>
        {snapshot.status === "authenticated" &&
          snapshot.principal.role === "USER" && (
            <Link
              className="button button-primary"
              style={{ alignSelf: "flex-start" }}
              to="/chat"
            >
              {t("openChat")}
              <ArrowUpRight size={18} />
            </Link>
          )}
        <p className="muted">{t('integrationPending')}</p>
      </div>
    </PageFrame>
  );
}
