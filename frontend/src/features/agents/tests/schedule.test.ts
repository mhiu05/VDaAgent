// Routine schedules (doc 05 "Lịch": "Hằng ngày lúc HH:MM", "Hằng tuần vào <days> lúc HH:MM",
// "Mỗi N giờ", "Nâng cao" raw cron; schedules in words).
import { describe, expect, it } from "vitest";
import { describeCron, parseSchedule, toCron, validRoutineName } from "../model/schedule";

describe("routine schedules", () => {
  it("builds cron from the picker", () => {
    expect(toCron({ kind: "daily", time: "08:30" })).toBe("30 8 * * *");
    expect(toCron({ kind: "weekly", time: "17:00", days: [1] })).toBe("0 17 * * 1");
    expect(toCron({ kind: "weekly", time: "08:00", days: [3, 1] })).toBe("0 8 * * 1,3");
    expect(toCron({ kind: "hourly", hours: 3 })).toBe("0 */3 * * *");
    expect(toCron({ kind: "cron", cron: " */15 * * * * " })).toBe("*/15 * * * *");
  });

  it("reads cron back into the picker, falling back to raw cron", () => {
    expect(parseSchedule("30 8 * * *")).toEqual({ kind: "daily", time: "08:30" });
    expect(parseSchedule("0 17 * * 1")).toEqual({ kind: "weekly", time: "17:00", days: [1] });
    expect(parseSchedule("0 8 * * 1,3")).toEqual({ kind: "weekly", time: "08:00", days: [1, 3] });
    expect(parseSchedule("0 */3 * * *")).toEqual({ kind: "hourly", hours: 3 });
    expect(parseSchedule("5 7 1 * *")).toEqual({ kind: "cron", cron: "5 7 1 * *" });
    expect(parseSchedule("*/15 * * * *")).toEqual({ kind: "cron", cron: "*/15 * * * *" });
    expect(parseSchedule("5 */3 * * *")).toEqual({ kind: "cron", cron: "5 */3 * * *" });
  });

  it("describes schedules in words", () => {
    expect(describeCron("30 8 * * *", "vi")).toBe("Hằng ngày lúc 08:30");
    expect(describeCron("0 8 * * 1,3", "vi")).toBe("Hằng tuần vào Thứ Hai, Thứ Tư lúc 08:00");
    expect(describeCron("0 */3 * * *", "vi")).toBe("Mỗi 3 giờ");
    expect(describeCron("*/15 * * * *", "vi")).toBe("cron: */15 * * * *");
    expect(describeCron("0 17 * * 0", "en")).toBe("Every Sunday at 17:00");
    expect(describeCron("0 */3 * * *", "en")).toBe("Every 3 hours");
  });

  it("checks routine names like the folder does", () => {
    expect(validRoutineName("bao-cao-sang")).toBe(true);
    expect(validRoutineName("Báo cáo")).toBe(false);
    expect(validRoutineName("")).toBe(false);
  });
});
