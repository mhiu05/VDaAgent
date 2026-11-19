import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import {
  createBrowserRouter,
  RouterProvider,
  Routes,
  Route,
  Navigate,
  useLocation,
  Link,
} from "react-router";
import { I18nextProvider, useTranslation } from "react-i18next";
import { i18n } from "./i18n/messages";
import { ServicesProvider, useServices } from "./providers/ServicesProvider";
import { AGENT_CHAT_KEY } from "../features/chat/services/agent-chat-service";
import { AuthProvider, useAuth } from "../features/auth/providers/AuthProvider";
import { PreferencesProvider } from "./providers/PreferencesProvider";
import { OverlayProvider } from "./providers/OverlayProvider";
import { FeedbackProvider } from "../shared/ui/feedback";
import { PublicLayout } from "./layouts/PublicLayout";
import { UserLayout } from "./layouts/UserLayout";
import { AdminLayout } from "./layouts/AdminLayout";
import { homeFor } from "../shared/contracts/auth";
import { PageState } from "../shared/ui/page";
import { features } from "./feature-registry";
import { requiredRole } from "./routing/access";
import { ErrorBoundary } from "./ErrorBoundary";
import type { Services } from "./services/services";
import { loadPage as loadLogin } from "../features/auth/entry";
const Login = lazy(loadLogin);
const pages = features.flatMap((f) =>
  [f.path, ...(f.detailPaths ?? [])].map((path) => ({
    path,
    Page: lazy(f.loadPage),
  })),
);
function RouterContent() {
  const { snapshot, restore, logout } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();
  // the real chat port means the app runs on the API, not on demo data
  const api = Boolean(useServices().workspace[AGENT_CHAT_KEY]);
  useEffect(() => {
    const timer = setTimeout(() => {
      const heading = document.querySelector<HTMLElement>("main h1");
      heading?.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(timer);
  }, [location.pathname]);
  if (snapshot.status === "checking")
    return (
      <PublicLayout>
        <PageState kind="loading" title={t("loading")} />
      </PublicLayout>
    );
  if (snapshot.status === "error")
    return (
      <PublicLayout>
        <PageState
          kind="error"
          title={t("error")}
          action={
            <>
              <button onClick={() => void restore()}>{t("retry")}</button>
              <button onClick={logout}>{t("signOut")}</button>
            </>
          }
        />
      </PublicLayout>
    );
  if (snapshot.status === "anonymous")
    return location.pathname === "/login" ? (
      <PublicLayout>
        <Login />
      </PublicLayout>
    ) : requiredRole(location.pathname) ? (
      <Navigate to="/login" replace />
    ) : (
      <PublicLayout>
        <PageState
          headingLevel={1}
          kind="empty"
          title={t("notFound")}
          description={t("notFoundText")}
          action={<Link to="/login">{t("home")}</Link>}
        />
      </PublicLayout>
    );
  const home = homeFor(snapshot.principal.role, api);
  if (location.pathname === "/login") return <Navigate to={home} replace />;
  const role = requiredRole(location.pathname);
  const content: ReactNode =
    role && role !== snapshot.principal.role ? (
      <PageState
        kind="unauthorized"
        headingLevel={1}
        title={t("unauthorized")}
        description={t("denied")}
        action={<Link to={home}>{t("home")}</Link>}
      />
    ) : (
      <Routes>
        {pages.map(({ path, Page }) => (
          <Route key={path} path={path} element={<Page />} />
        ))}
        <Route
          path="*"
          element={
            <PageState
              kind="empty"
              headingLevel={1}
              title={t("notFound")}
              description={t("notFoundText")}
              action={<Link to={home}>{t("home")}</Link>}
            />
          }
        />
      </Routes>
    );
  if (location.pathname === "/chat/file-preview") return content;
  return snapshot.principal.role === "ADMIN" ? (
    <AdminLayout>{content}</AdminLayout>
  ) : (
    <UserLayout>{content}</UserLayout>
  );
}
function RoutedApp() {
  const { snapshot } = useAuth();
  return (
    <OverlayProvider
      key={
        snapshot.status === "authenticated" ? snapshot.principal.id : "public"
      }
    >
      <Suspense
        fallback={<PageState kind="loading" title={i18n.t("loading")} />}
      >
        <RouterContent />
      </Suspense>
    </OverlayProvider>
  );
}
export function App({ services }: { services: Services }) {
  const [router, setRouter] = useState<ReturnType<typeof createBrowserRouter>>();
  useEffect(() => {
    // Bind browser history to this App's lifetime, including StrictMode remounts.
    const instance = createBrowserRouter([{ path: "*", element: <RoutedApp /> }]);
    setRouter(instance);
    return () => instance.dispose();
  }, []);
  return (
    <ErrorBoundary>
      <ServicesProvider services={services}>
        <AuthProvider>
          <PreferencesProvider>
            <I18nextProvider i18n={i18n}>
              <FeedbackProvider>
                {router ? (
                  <RouterProvider router={router} />
                ) : (
                  <PageState kind="loading" title={i18n.t("loading")} />
                )}
              </FeedbackProvider>
            </I18nextProvider>
          </PreferencesProvider>
        </AuthProvider>
      </ServicesProvider>
    </ErrorBoundary>
  );
}
