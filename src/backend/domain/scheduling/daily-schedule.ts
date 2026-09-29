import type { ReportDefinitionInput } from '@vda/contracts/reports/schedule';

export function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function nextScheduledAt(
  def: Pick<ReportDefinitionInput, 'timezone' | 'local_time'>,
  after: Date,
): string {
  // Minute enumeration handles DST gaps and folds without assuming a fixed UTC offset.
  const start = Math.floor(after.getTime() / 60000) * 60000 + 60000;
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: def.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const afterDay = localDate(after, def.timezone);
  const pastDailyTime = formatter.format(after) >= def.local_time;
  for (let i = 0; i < 3000; i++) {
    const at = new Date(start + i * 60000);
    const time = formatter.format(at);
    if (time === def.local_time && (!pastDailyTime || localDate(at, def.timezone) > afterDay))
      return at.toISOString();
  }
  throw new Error('SCHEDULE_UNRESOLVABLE');
}
export function scheduledOnDate(
  def: Pick<ReportDefinitionInput, 'timezone' | 'local_time'>,
  day: string,
): string {
  const start = new Date(Date.parse(`${day}T00:00:00Z`) - 16 * 3600000);
  let slot = nextScheduledAt(def, start);
  for (let i = 0; i < 3 && localDate(new Date(slot), def.timezone) < day; i++)
    slot = nextScheduledAt(def, new Date(slot));
  if (localDate(new Date(slot), def.timezone) !== day)
    throw new Error('SCHEDULE_TIME_ABSENT_ON_DATE');
  return slot;
}
