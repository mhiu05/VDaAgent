import { ArrowLeft, Bot, Check, ChevronDown, Globe2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { usePreferences } from "../../../app/providers/PreferencesProvider";
import { BrandMark } from "../../../shared/ui/identity";
import { LoginForm } from "./LoginForm";
import { QuickDemoAccess } from "./QuickDemoAccess";
import { LandingPage } from "./LandingPage";
import robotHero from "../../../assets/agent-robots/robot-login-hero.png";
import "./desktop.css";

export function PreAuthDesktop() {
  const { t } = useTranslation(["auth", "app"]);
  const { preferences, preview, save } = usePreferences();
  const [view, setView] = useState<"landing" | "auth">("landing");
  const [languageOpen, setLanguageOpen] = useState(false);
  const languageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeLanguage = (event: MouseEvent) => {
      if (!languageRef.current?.contains(event.target as Node)) setLanguageOpen(false);
    };
    document.addEventListener("mousedown", closeLanguage);
    return () => document.removeEventListener("mousedown", closeLanguage);
  }, []);

  function changeLanguage(locale: "vi" | "en") {
    const next = { ...preferences, locale };
    preview(next);
    void save(next);
    setLanguageOpen(false);
  }
  return (
    <div className={`sd-desktop sd-auth-page is-${view}`}>
      <header className="sd-auth-header">
        <button type="button" className="sd-brand" aria-label="VDaAgent" onClick={() => setView("landing")}>
          <BrandMark size={32} />
          <strong>VDaAgent</strong>
          <span>AI workspace</span>
        </button>
        <div className="sd-auth-controls">
          <div className="sd-language" ref={languageRef}>
            <button
              type="button"
              className="sd-language-trigger"
              aria-label={t("app:language")}
              aria-haspopup="listbox"
              aria-expanded={languageOpen}
              onClick={() => setLanguageOpen((value) => !value)}
            >
              <Globe2 size={16} aria-hidden="true" />
              <span>{preferences.locale === "vi" ? "Tiếng Việt" : "English"}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {languageOpen && (
              <div className="sd-language-menu" role="listbox" aria-label={t("app:language")}>
                <button type="button" role="option" aria-selected={preferences.locale === "vi"} onClick={() => changeLanguage("vi")}>
                  <span><b>VI</b><i>Tiếng Việt</i></span>{preferences.locale === "vi" && <Check size={15} />}
                </button>
                <button type="button" role="option" aria-selected={preferences.locale === "en"} onClick={() => changeLanguage("en")}>
                  <span><b>EN</b><i>English</i></span>{preferences.locale === "en" && <Check size={15} />}
                </button>
              </div>
            )}
          </div>
          {view === "auth" && (
            <button type="button" className="sd-header-login" onClick={() => setView("landing")}>
              <ArrowLeft size={16} /> Quay lại demo
            </button>
          )}
        </div>
      </header>
      {view === "landing" ? (
        <LandingPage openAuth={() => setView("auth")} />
      ) : (
        <section className="sd-auth-center" aria-label={t("formDescription")}>
          <div className="sd-auth-intro">
            <span><Bot size={18} /> CREATE YOUR OWN AGENT</span>
            <h1>Bắt đầu không gian AI của riêng bạn.</h1>
            <p>Đăng nhập bằng tài khoản được cấp hoặc dùng tài khoản demo bên dưới để trải nghiệm ngay.</p>
            <div><CheckLine>6 agent chuyên biệt</CheckLine><CheckLine>Nhóm chat người + agent</CheckLine><CheckLine>Domain riêng cho tổ chức</CheckLine></div>
          </div>
          <div className="sd-auth-card">
            <LoginForm />
          </div>
          <div className="sd-auth-aside">
            <div className="sd-auth-robot">
              <img src={robotHero} alt={t("heroRobotAlt")} decoding="async" fetchPriority="high" />
            </div>
            <QuickDemoAccess />
          </div>
        </section>
      )}
    </div>
  );
}

function CheckLine({ children }: { children: ReactNode }) {
  return <span><i>✓</i>{children}</span>;
}
