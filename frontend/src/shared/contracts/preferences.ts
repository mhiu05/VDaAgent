export interface Preferences {
  displayName: string;
  locale: "vi" | "en";
  theme: "light" | "dark" | "system";
  timezone: string;
  motion: "system" | "reduce";
  density: "comfortable" | "compact";
  notifications: { reports: boolean; tasks: boolean; system: boolean };
  semanticExplanation: boolean;
}
export function validTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
export const defaultPreferences = (displayName = ""): Preferences => ({
  displayName,
  locale: "vi",
  theme: "light",
  timezone: validTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone)
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : "Asia/Ho_Chi_Minh",
  motion: "system",
  density: "comfortable",
  notifications: { reports: true, tasks: true, system: true },
  semanticExplanation: false,
});
export function isPreferences(v: unknown): v is Preferences {
  if (!v || typeof v !== "object") return false;
  const p = v as Preferences;
  return (
    typeof p.displayName === "string" &&
    p.displayName.length <= 100 &&
    ["vi", "en"].includes(p.locale) &&
    ["light", "dark", "system"].includes(p.theme) &&
    validTimezone(p.timezone) &&
    ["system", "reduce"].includes(p.motion) &&
    ["comfortable", "compact"].includes(p.density) &&
    !!p.notifications &&
    ["reports", "tasks", "system"].every(
      (k) =>
        typeof p.notifications[k as keyof Preferences["notifications"]] ===
        "boolean",
    ) &&
    typeof p.semanticExplanation === "boolean"
  );
}
