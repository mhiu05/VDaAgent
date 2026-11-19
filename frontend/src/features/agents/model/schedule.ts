/** The routine schedule picker (doc 05 "Lịch"): "Hằng ngày lúc HH:MM", "Hằng tuần vào <days> lúc
 * HH:MM", "Mỗi N giờ" and "Nâng cao" raw 5-field cron. Times are Asia/Ho_Chi_Minh, like the
 * scheduler. */
export type Schedule =
  | { kind: "daily"; time: string }
  | { kind: "weekly"; time: string; days: number[] }
  | { kind: "hourly"; hours: number }
  | { kind: "cron"; cron: string };

const NAME_RE = /^[a-z0-9-]{2,32}$/;
export const validRoutineName = (name: string) => NAME_RE.test(name);

const dow = (days: readonly number[]) => [...new Set(days)].sort((a, b) => a - b);

export function toCron(s: Schedule): string {
  if (s.kind === "cron") return s.cron.trim().replace(/\s+/g, " ");
  if (s.kind === "hourly") return `0 */${Math.max(1, Math.round(s.hours))} * * *`;
  const [h, m] = s.time.split(":").map(Number);
  if (s.kind === "daily") return `${m} ${h} * * *`;
  const days = dow(s.days);
  return `${m} ${h} * * ${days.length ? days.join(",") : "*"}`;
}

const NUM = /^\d+$/;
export function parseSchedule(cron: string): Schedule {
  const parts = cron.trim().split(/\s+/);
  const raw = cron.trim();
  if (parts.length === 5 && NUM.test(parts[0]) && NUM.test(parts[1]) && parts[3] === "*" && Number(parts[0]) < 60 && Number(parts[1]) < 24) {
    const [m, h, dom, , d] = parts;
    const time = `${String(Number(h)).padStart(2, "0")}:${String(Number(m)).padStart(2, "0")}`;
    if (dom === "*" && d === "*") return { kind: "daily", time };
    if (dom === "*" && /^[0-6](,[0-6])*$/.test(d)) return { kind: "weekly", time, days: dow(d.split(",").map(Number)) };
  }
  if (parts.length === 5 && parts[0] === "0" && /^\*\/\d+$/.test(parts[1]) && parts.slice(2).every((p) => p === "*")) {
    const hours = Number(parts[1].slice(2));
    if (hours >= 1 && hours <= 23) return { kind: "hourly", hours };
  }
  return { kind: "cron", cron: raw };
}

const WEEKDAYS = {
  vi: ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};
export const weekdayNames = (locale: "vi" | "en") => WEEKDAYS[locale];

export function describeCron(cron: string, locale: "vi" | "en"): string {
  const s = parseSchedule(cron);
  const vi = locale === "vi";
  switch (s.kind) {
    case "daily":
      return vi ? `Hằng ngày lúc ${s.time}` : `Every day at ${s.time}`;
    case "weekly": {
      const names = dow(s.days).map((d) => WEEKDAYS[locale][d]);
      return vi ? `Hằng tuần vào ${names.join(", ")} lúc ${s.time}` : `Every ${names.join(", ")} at ${s.time}`;
    }
    case "hourly":
      return vi ? `Mỗi ${s.hours} giờ` : `Every ${s.hours} hours`;
    case "cron":
      return `cron: ${s.cron}`;
  }
}
