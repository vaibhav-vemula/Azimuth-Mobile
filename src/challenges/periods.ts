export type Period = 'daily' | 'weekly' | 'once';

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** ISO week of a UTC instant: the year the week belongs to and its number. */
function isoWeek(ms: number): { year: number; week: number } {
  const d = new Date(ms);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const mondayIndex = (new Date(t).getUTCDay() + 6) % 7;
  const thursday = t + (3 - mondayIndex) * DAY;
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY / 7) + 1;
  return { year, week };
}

export function periodKey(period: Period, ms: number): string {
  if (period === 'daily') return new Date(ms).toISOString().slice(0, 10);
  if (period === 'weekly') {
    const { year, week } = isoWeek(ms);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }
  return 'once';
}

export function previousPeriodKey(period: Period, ms: number): string {
  if (period === 'daily') return periodKey('daily', ms - DAY);
  if (period === 'weekly') return periodKey('weekly', ms - WEEK);
  return 'once';
}

export function periodWindow(period: Period, key: string, nowMs: number): { fromMs: number; toMs: number } {
  if (period === 'once') return { fromMs: 0, toMs: nowMs + 1 };
  if (period === 'daily') {
    const from = Date.parse(`${key}T00:00:00Z`);
    return { fromMs: from, toMs: from + DAY };
  }
  const m = /^(\d{4})-W(\d{2})$/.exec(key)!;
  const jan4 = Date.UTC(Number(m[1]), 0, 4);
  const week1Monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
  const from = week1Monday + (Number(m[2]) - 1) * WEEK;
  return { fromMs: from, toMs: from + WEEK };
}

export function isClaimablePeriod(period: Period, key: unknown, nowMs: number): boolean {
  if (typeof key !== 'string') return false;
  return key === periodKey(period, nowMs) || key === previousPeriodKey(period, nowMs);
}
