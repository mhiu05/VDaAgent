import { useEffect, useRef, useState, type FormEvent } from "react";
import { useBlocker } from "react-router";
import { useTranslation } from "react-i18next";
import { createApiClient } from "../../../adapters/api/http";
import {
  Sun,
  Moon,
  Monitor,
  RotateCcw,
  Check,
  Globe,
  SlidersHorizontal,
  UserRound,
  Bell,
  Accessibility,
  Database,
  Languages,
  Send,
} from "lucide-react";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { useServices } from "../../../app/providers/ServicesProvider";
import { useAuth } from "../../auth/providers/AuthProvider";
import { PageFrame } from "../../../shared/ui/page";
import { Button } from "../../../shared/ui/button";
import { Input, Select, FormField, Switch } from "../../../shared/ui/form";
import { InlineAlert, useFeedback } from "../../../shared/ui/feedback";
import { Dialog } from "../../../shared/ui/overlay";
import {
  validTimezone,
  type Preferences,
} from "../../../shared/contracts/preferences";
import { formatDate } from "../../../shared/lib/format";
import "./settings.css";
const zones = Intl.supportedValuesOf("timeZone");

interface TelegramLink {
  code: string;
  deep_link: string;
  expires_at: string;
}

/** `/api/telegram/*`: linking is optional and outside the preferences save flow, so it talks
 * to the API with the shared client (same origin, session cookie, `X-Contoso-Client`) instead of
 * going through the mock/api services port. */
const telegramApi = createApiClient();

function TelegramSection() {
  const [linked, setLinked] = useState<boolean | null>(null);
  const [link, setLink] = useState<TelegramLink | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    telegramApi
      .get<{ linked: boolean }>("/api/telegram/status")
      .then((data) => {
        if (active) setLinked(data.linked);
      })
      .catch(() => {
        if (active) setLinked(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function createLink() {
    setPending(true);
    setError("");
    try {
      setLink(await telegramApi.post<TelegramLink>("/api/telegram/link"));
    } catch {
      setError("Không thể tạo mã liên kết.");
    } finally {
      setPending(false);
    }
  }

  async function unlink() {
    setPending(true);
    setError("");
    try {
      await telegramApi.post("/api/telegram/unlink");
      setLinked(false);
      setLink(null);
    } catch {
      setError("Không thể hủy liên kết.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="demo-settings">
      <Send size={20} />
      <div>
        <h2>Telegram</h2>
        {linked ? (
          <>
            <p>
              Tài khoản của bạn đã liên kết với Telegram. Agent điều phối sẽ trả lời cả trên
              web và Telegram.
            </p>
            <Button onClick={() => void unlink()} pending={pending}>
              Hủy liên kết
            </Button>
          </>
        ) : (
          <>
            <p>Liên kết để chat với agent điều phối của bạn ngay trên Telegram.</p>
            {link && (
              <p>
                Mở{" "}
                <a href={link.deep_link} target="_blank" rel="noreferrer">
                  {link.deep_link}
                </a>{" "}
                hoặc gửi <code>/start {link.code}</code> cho bot trên Telegram. Mã hết hạn lúc{" "}
                {new Date(link.expires_at).toLocaleTimeString()}.
              </p>
            )}
            {error && <InlineAlert kind="error">{error}</InlineAlert>}
            <Button onClick={() => void createLink()} pending={pending}>
              {link ? "Tạo mã mới" : "Liên kết Telegram"}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const { t } = useTranslation(["settings", "app"]);
  const {
    preferences: p,
    saved,
    preview,
    setTheme,
    save,
    cancel,
    degraded,
  } = usePreferences();
  const { snapshot } = useAuth();
  const services = useServices();
  const notify = useFeedback();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [zone, setZone] = useState(p.timezone);
  const [name, setName] = useState(p.displayName);
  const resetTrigger = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  const dirty =
    JSON.stringify(p) !== JSON.stringify(saved) ||
    zone !== saved.timezone ||
    name !== saved.displayName;
  const blocker = useBlocker(dirty);
  useEffect(() => () => cancelRef.current(), []);
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [dirty]);
  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    preview({ ...p, [key]: value });
  }
  function revert() {
    cancel();
    setZone(saved.timezone);
    setName(saved.displayName);
    setError("");
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!name.trim() || name.length > 100) {
      setError("settings:nameError");
      return;
    }
    if (!validTimezone(zone)) {
      setError("settings:timezoneError");
      return;
    }
    setPending(true);
    const eKey = await save({ ...p, displayName: name, timezone: zone });
    setPending(false);
    setError(eKey ?? "");
  }
  async function reset() {
    if (snapshot.status !== "authenticated") return;
    setResetPending(true);
    await services.chat.reset(snapshot.principal.id);
    services.notifications.reset(snapshot.principal.id);
    setResetPending(false);
    setResetOpen(false);
    notify({ kind: "success", title: t("resetDone") });
  }
  const principal =
    snapshot.status === "authenticated" ? snapshot.principal : null;
  return (
    <PageFrame title={t("title")}>
      <form onSubmit={(e) => void submit(e)} className="settings-form">
        <section>
          <header>
            <UserRound size={19} />
            <div>
              <h2>{t("profile")}</h2>
              <p>{t("profileHint")}</p>
            </div>
          </header>
          <div className="settings-fields">
            <FormField
              id="display-name"
              label={t("name")}
              error={
                name.trim() && name.length <= 100 ? undefined : t("nameError")
              }
            >
              <Input
                id="display-name"
                value={name}
                maxLength={100}
                onChange={(e) => {
                  setName(e.target.value);
                  update("displayName", e.target.value);
                }}
                aria-invalid={!name.trim()}
                aria-describedby={
                  !name.trim() ? "display-name-error" : undefined
                }
              />
            </FormField>
            <div className="settings-grid">
              <FormField id="profile-email" label={t("email")}>
                <Input
                  id="profile-email"
                  value={principal?.email ?? ""}
                  readOnly
                />
              </FormField>
              <FormField id="profile-role" label={t("role")}>
                <Input
                  id="profile-role"
                  value={principal?.role ?? ""}
                  readOnly
                />
              </FormField>
            </div>
          </div>
        </section>
        <section>
          <header>
            <SlidersHorizontal size={19} />
            <div>
              <h2>{t("appearance")}</h2>
              <p>{t("appearanceHint")}</p>
            </div>
          </header>
          <div className="settings-fields">
            <fieldset className="theme-options">
              <legend>{t("theme")}</legend>
              {(["light", "dark", "system"] as const).map((theme) => {
                const Icon =
                  theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
                return (
                  <label
                    key={theme}
                    className={p.theme === theme ? "theme-selected" : ""}
                  >
                    <input
                      type="radio"
                      name="theme"
                      value={theme}
                      checked={p.theme === theme}
                      onChange={() => void setTheme(theme)}
                    />
                    <span className={`theme-preview ${theme}`}>
                      <Icon size={24} />
                    </span>
                    <span>
                      {t(`app:${theme}`)}
                      {p.theme === theme && <Check size={14} />}
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <FormField id="density" label={t("density")}>
              <Select
                id="density"
                value={p.density}
                onChange={(e) =>
                  update("density", e.target.value as Preferences["density"])
                }
              >
                <option value="comfortable">{t("comfortable")}</option>
                <option value="compact">{t("compact")}</option>
              </Select>
            </FormField>
          </div>
        </section>
        <section>
          <header>
            <Globe size={19} />
            <div>
              <h2>{t("region")}</h2>
              <p>{t("regionHint")}</p>
            </div>
          </header>
          <div className="settings-fields">
            <div className="settings-grid">
              <FormField id="language" label={t("app:language")}>
                <Select
                  id="language"
                  value={p.locale}
                  onChange={(e) =>
                    update("locale", e.target.value as "vi" | "en")
                  }
                >
                  <option value="vi">Tiếng Việt</option>
                  <option value="en">English</option>
                </Select>
              </FormField>
              <FormField
                id="timezone"
                label={t("timezone")}
                error={validTimezone(zone) ? undefined : t("timezoneError")}
              >
                <Input
                  id="timezone"
                  list="timezones"
                  value={zone}
                  onChange={(e) => {
                    setZone(e.target.value);
                    if (validTimezone(e.target.value))
                      update("timezone", e.target.value);
                  }}
                  aria-invalid={!validTimezone(zone)}
                  aria-describedby={
                    !validTimezone(zone) ? "timezone-error" : undefined
                  }
                />
                <datalist id="timezones">
                  <option value="UTC" />
                  {zones.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </FormField>
            </div>
            <div className="timezone-preview">
              <span className="eyebrow">{t("preview")}</span>
              <span className="number">
                {formatDate(
                  services.context.clock.now().toISOString(),
                  p.locale,
                  p.timezone,
                )}
              </span>
            </div>
          </div>
        </section>
        <section>
          <header>
            <Bell size={19} />
            <div>
              <h2>{t("notifications")}</h2>
              <p>{t("notificationsHint")}</p>
            </div>
          </header>
          <div className="settings-fields">
            {(["reports", "tasks", "system"] as const).map((key) => (
              <Switch
                key={key}
                label={t(key)}
                checked={p.notifications[key]}
                onChange={(e) =>
                  update("notifications", {
                    ...p.notifications,
                    [key]: e.target.checked,
                  })
                }
              />
            ))}
          </div>
        </section>
        <section>
          <header>
            <Languages size={19} />
            <div>
              <h2>{t("semanticExplanation")}</h2>
              <p>{t("semanticExplanationHint")}</p>
            </div>
          </header>
          <div className="settings-fields">
            <Switch
              label={t("semanticExplanation")}
              checked={p.semanticExplanation}
              onChange={(e) => update("semanticExplanation", e.target.checked)}
            />
          </div>
        </section>
        <section>
          <header>
            <Accessibility size={19} />
            <div>
              <h2>{t("accessibility")}</h2>
              <p>{t("motionHint")}</p>
            </div>
          </header>
          <div className="settings-fields">
            <FormField id="motion" label={t("motion")}>
              <Select
                id="motion"
                value={p.motion}
                onChange={(e) =>
                  update("motion", e.target.value as Preferences["motion"])
                }
              >
                <option value="system">{t("motionSystem")}</option>
                <option value="reduce">{t("motionReduce")}</option>
              </Select>
            </FormField>
          </div>
        </section>
        {degraded && <InlineAlert>{t("app:storage")}</InlineAlert>}
        {error && <InlineAlert kind="error">{t(error)}</InlineAlert>}
        <footer className="settings-save">
          <span className="muted" role="status" aria-live="polite">
            {t(dirty ? "unsaved" : "upToDate")}
          </span>
          <div className="row">
            <Button disabled={!dirty || pending} onClick={revert}>
              {t("app:cancel")}
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={!dirty}
              pending={pending}
            >
              {pending ? t("app:loading") : t("app:save")}
            </Button>
          </div>
        </footer>
      </form>
      <section className="demo-settings">
        <Database size={20} />
        <div>
          <h2>{t("demo")}</h2>
          <p>{t("demoHint")}</p>
          <Button ref={resetTrigger} onClick={() => setResetOpen(true)}>
            <RotateCcw size={15} />
            {t("resetDemo")}
          </Button>
        </div>
      </section>
      <TelegramSection />
      <Dialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title={t("resetTitle")}
        description={t("resetDescription")}
        triggerRef={resetTrigger}
        closeLabel={t("app:close")}
      >
        <div className="row" style={{ marginTop: 24 }}>
          <Button onClick={() => setResetOpen(false)}>{t("app:cancel")}</Button>
          <Button
            variant="danger"
            pending={resetPending}
            onClick={() => void reset()}
          >
            {t("resetDemo")}
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open && blocker.state === "blocked") blocker.reset();
        }}
        title={t("discardTitle")}
        description={t("discardDescription")}
        closeLabel={t("app:close")}
      >
        <div className="row" style={{ marginTop: 24 }}>
          <Button
            onClick={() => {
              if (blocker.state === "blocked") blocker.reset();
            }}
          >
            {t("stay")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              cancel();
              if (blocker.state === "blocked") blocker.proceed();
            }}
          >
            {t("app:discard")}
          </Button>
        </div>
      </Dialog>
    </PageFrame>
  );
}
