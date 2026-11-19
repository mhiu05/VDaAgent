import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "../../features/auth/providers/AuthProvider";
import {
  defaultPreferences,
  type Preferences,
} from "../../shared/contracts/preferences";
import { useServices } from "./ServicesProvider";
import { i18n } from "../i18n/messages";
interface PreferencesValue {
  preferences: Preferences;
  saved: Preferences;
  preview(p: Preferences): void;
  setTheme(theme: Preferences["theme"]): Promise<string | null>;
  cancel(): void;
  save(next?: Preferences): Promise<string | null>;
  degraded: boolean;
  reducedMotion: boolean;
}
const Context = createContext<PreferencesValue | null>(null);
function ScopedPreferences({
  id,
  name,
  children,
}: {
  id: string;
  name: string;
  children: ReactNode;
}) {
  const { preferences: service } = useServices();
  const [saved, setSaved] = useState(() =>
    id === "public" ? defaultPreferences() : service.load(id, name),
  );
  const [preferences, preview] = useState(saved);
  const themeSave = useRef<Promise<string | null>>(Promise.resolve(null));
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [osReduce, setOsReduce] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const dark = matchMedia("(prefers-color-scheme: dark)"),
      reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const d = () => setSystemDark(dark.matches),
      r = () => setOsReduce(reduce.matches);
    dark.addEventListener("change", d);
    reduce.addEventListener("change", r);
    return () => {
      dark.removeEventListener("change", d);
      reduce.removeEventListener("change", r);
    };
  }, []);
  const reducedMotion = osReduce || preferences.motion === "reduce";
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme =
      preferences.theme === "system"
        ? systemDark
          ? "dark"
          : "light"
        : preferences.theme;
    root.dataset.motion = reducedMotion ? "reduce" : "system";
    root.dataset.density = preferences.density;
    root.lang = preferences.locale;
    void i18n.changeLanguage(preferences.locale);
  }, [preferences, systemDark, reducedMotion]);
  const value = useMemo(
    () => ({
      preferences,
      saved,
      preview,
      setTheme: (theme: Preferences["theme"]) => {
        preview((current) => ({ ...current, theme }));
        const operation = themeSave.current.then(async () => {
          const r = await service.save(id, { ...saved, theme });
          if (r.error) return r.error.messageKey;
          setSaved(r.data);
          preview((current) => ({ ...current, theme: r.data.theme }));
          return null;
        });
        themeSave.current = operation;
        return operation;
      },
      cancel: () => preview(saved),
      degraded: service.degraded,
      reducedMotion,
      save: async (next = preferences) => {
        await themeSave.current;
        const r = await service.save(id, next);
        if (r.error) return r.error.messageKey;
        setSaved(r.data);
        preview(r.data);
        return null;
      },
    }),
    [preferences, saved, service, id, reducedMotion],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { snapshot } = useAuth();
  const p = snapshot.status === "authenticated" ? snapshot.principal : null;
  return (
    <ScopedPreferences
      key={p?.id ?? "public"}
      id={p?.id ?? "public"}
      name={p?.displayName ?? ""}
    >
      {children}
    </ScopedPreferences>
  );
}
export function usePreferences() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing PreferencesProvider");
  return value;
}
