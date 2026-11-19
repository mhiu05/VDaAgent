import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { Menu as MenuIcon, LogOut } from "lucide-react";
import type { Role } from "../../shared/contracts/auth";
import { features } from "../feature-registry";
import { navigationIcons } from "./icons";
import { useAuth } from "../../features/auth/providers/AuthProvider";
import { usePreferences } from "../providers/PreferencesProvider";
import { useOverlay } from "../providers/OverlayProvider";
import { IconButton } from "../../shared/ui/button";
import { Avatar, BrandMark } from "../../shared/ui/identity";
import { InlineAlert } from "../../shared/ui/feedback";
import "./shell.css";
import { useUnreadCount } from "../../features/notifications/state/NotificationsProvider";
import { useServices } from "../providers/ServicesProvider";
import { AGENT_CHAT_KEY } from "../../features/chat/services/agent-chat-service";
import { ParticleBackground } from "./ParticleBackground";

export function SystemShell({
  role,
  children,
}: {
  role: Role;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { snapshot, logout } = useAuth();
  // the real chat port means the app runs on the API, not on demo data
  const demo = !useServices().workspace[AGENT_CHAT_KEY];
  const { preferences, degraded } = usePreferences();
  const profileName = preferences.displayName || "Demo";
  const unread = useUnreadCount();
  const overlay = useOverlay();
  const trigger = useRef<HTMLButtonElement>(null);
  const rail = useRef<HTMLElement>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && rail.current?.matches(":hover,:focus-within")) {
        setDismissed(true);
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, []);
  const location = useLocation();
  const workspace = useServices().workspace;
  const entries = features
    .filter((e) => e.role === role && (!e.requires || workspace[e.requires]))
    .sort((a, b) => a.navigation.order - b.navigation.order);
  const navigation = (drawer = false) => (
    <>
      <div className="brand-lockup">
        <BrandMark />
        <span>VDaAgent</span>
      </div>
      <nav aria-label={t("menu")} className="system-links">
        {entries.map((e) => {
          const Icon = navigationIcons[e.navigation.iconKey];
          return (
            <NavLink
              key={e.id}
              to={e.path}
              end={e.path === "/"}
              aria-label={`${t(e.navigation.labelKey.replace(".", ":"))}${e.id === "notifications" && unread > 0 ? ` · ${unread} ${t("unread")}` : ""}`}
              title={t(e.navigation.labelKey.replace(".", ":"))}
              onClick={(event) => {
                if (drawer) overlay.close();
                else if (event.detail > 0) setDismissed(true);
              }}
            >
              <Icon size={20} />
              <span className="nav-label">
                {t(e.navigation.labelKey.replace(".", ":"))}
              </span>
              {e.id === "notifications" && unread > 0 && (
                <span
                  className="unread-count"
                  aria-label={`${unread} ${t("unread")}`}
                >
                  {unread}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
      <div className="system-profile">
        {role === "USER" ? (
          <NavLink
            to="/setting"
            aria-label={`${profileName.slice(0, 2).toUpperCase()} ${profileName} ${role} · ${t("profile")}`}
            onClick={(event) => {
              if (drawer) overlay.close();
              else if (event.detail > 0) setDismissed(true);
            }}
          >
            <span className="profile-avatar" aria-hidden="true">
              <Avatar name={profileName} />
            </span>{" "}
            <span className="nav-label" title={profileName}>
              <strong>{profileName}</strong>{" "}
              <small>
                {snapshot.status === "authenticated"
                  ? snapshot.principal.role
                  : ""}
              </small>
            </span>
          </NavLink>
        ) : (
          <div className="profile-identity">
            <Avatar name="Admin" />
            <span className="nav-label">ADMIN</span>
          </div>
        )}
        <button
          onClick={() => {
            overlay.close();
            logout();
          }}
          aria-label={t("signOut")}
          title={t("signOut")}
        >
          <LogOut size={20} />
        </button>
      </div>
    </>
  );
  return (
    <div
      className={`app-shell ${/^\/chat(\/|$)/.test(location.pathname) ? "is-chat-route" : ""}`}
    >
      <ParticleBackground />
      <a className="skip-link" href="#main-content">
        {t("skip")}
      </a>
      <aside
        ref={rail}
        aria-label={t("menu")}
        className={`system-sidebar ${dismissed ? "is-dismissed" : ""}`}
        onMouseLeave={() => setDismissed(false)}
        onBlur={(e) => {
          if (
            !e.currentTarget.contains(e.relatedTarget) &&
            !e.currentTarget.matches(":hover")
          )
            setDismissed(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDismissed(true);
          }
        }}
      >
        {navigation()}
      </aside>
      <div className="shell-content">
        <div className="mobile-bar">
          <IconButton
            ref={trigger}
            label={t("menu")}
            onClick={() =>
              overlay.open({
                id: "system",
                title: t("menu"),
                side: "left",
                triggerRef: trigger,
                content: <div className="mobile-nav">{navigation(true)}</div>,
              })
            }
          >
            <MenuIcon size={20} />
          </IconButton>
          <div className="mobile-brand">
            <BrandMark size={28} />
            <strong>VDaAgent</strong>
          </div>
          {demo ? <span className="badge">{t("demo")}</span> : null}
        </div>
        {degraded && <InlineAlert>{t("storage")}</InlineAlert>}
        {role === "USER" &&
        snapshot.status === "authenticated" &&
        snapshot.domain?.status === "unavailable" ? (
          <InlineAlert kind="error">{t("domainUnavailable")}</InlineAlert>
        ) : null}
        <main
          id="main-content"
          tabIndex={-1}
          className={
            /^\/chat(\/|$)/.test(location.pathname)
              ? "main-viewport"
              : "main-page"
          }
        >
          {children}
        </main>
      </div>
    </div>
  );
}
