export type Challenge = {
  id: string;
  title: string;
  blurb: string;
  period: 'daily' | 'weekly' | 'once';
  metric: 'mapping_minutes' | 'new_cells' | 'satellite_passes' | 'chests_opened';
  goal: number;
  reward: number;
  go: 'Map' | 'Satellites';
};

const PERIODS = ['daily', 'weekly', 'once'];
const METRICS = ['mapping_minutes', 'new_cells', 'satellite_passes', 'chests_opened'];
const TABS = ['Map', 'Satellites'];

/** A server row as a challenge, or null when anything about it is off. The server applies the same checks before paying. */
export function challengeFromRow(row: unknown): Challenge | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const goal = Number(r.goal);
  const reward = Number(r.reward);
  const ok =
    typeof r.id === 'string' && /^[a-z0-9-]{1,40}$/.test(r.id) &&
    typeof r.title === 'string' && r.title.length > 0 &&
    PERIODS.includes(r.period as string) && METRICS.includes(r.metric as string) && TABS.includes(r.go_tab as string) &&
    Number.isFinite(goal) && goal > 0 && Number.isInteger(reward) && reward >= 1 && reward <= 100;
  if (!ok) return null;
  return { id: r.id as string, title: r.title as string, blurb: typeof r.blurb === 'string' ? r.blurb : '', period: r.period as Challenge['period'], metric: r.metric as Challenge['metric'], goal, reward, go: r.go_tab as Challenge['go'] };
}
