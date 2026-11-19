import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../auth/providers/AuthProvider";
import { PageState } from "../../../shared/ui/page";
import "./provisioning.css";

/** How often the account status is re-read while provisioning runs (doc 12), and while it is
 * failed (an admin's retry turns it back into provisioning). */
export const PROVISIONING_POLL_MS = 4000;
export const FAILED_POLL_MS = 15000;

/** Shown instead of the chat while the user's account is provisioning or failed: the chat would
 * otherwise read as an empty, broken workspace. When the status turns `active` the snapshot
 * changes and the route renders the chat. */
export function ProvisioningState({ status }: { status: "provisioning" | "failed" }) {
  const { t } = useTranslation("chat");
  const { refreshStatus } = useAuth();
  useEffect(() => {
    // one request at a time: the next poll is scheduled only after the previous one answered
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const delay = status === "provisioning" ? PROVISIONING_POLL_MS : FAILED_POLL_MS;
    const tick = async () => {
      await refreshStatus();
      if (!stopped) timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [status, refreshStatus]);
  if (status === "failed") {
    return (
      <PageState kind="error" title={t("acProvisioningFailedTitle")}
        description={t("acProvisioningFailedBody")} />
    );
  }
  return (
    <div role="status" aria-live="polite">
      <PageState kind="loading" title={t("acProvisioningTitle")} description={t("acProvisioningBody")}
        action={<Loader2 className="provisioning-spinner" size={28} aria-hidden="true" />} />
    </div>
  );
}
