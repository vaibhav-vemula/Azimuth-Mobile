import * as Notifications from 'expo-notifications';
import { createMMKV } from 'react-native-mmkv';
import { Pass } from '../types/satellite';

const storage = createMMKV({ id: 'azimuth-reminders' });

export function computeTriggerDate(riseTime: Date, minutesBefore: number, now = new Date()): Date | null {
  const candidate = new Date(riseTime.getTime() - minutesBefore * 60_000);
  if (riseTime.getTime() <= now.getTime()) return null; // already started
  return candidate.getTime() < now.getTime() ? new Date(now.getTime() + 2000) : candidate;
}

export const Reminders = {
  has(passId: string): boolean {
    return storage.getString(passId) !== undefined;
  },

  async schedule(passId: string, pass: Pass, satelliteName: string, minutesBefore: number): Promise<boolean> {
    const triggerDate = computeTriggerDate(pass.riseTime, minutesBefore);
    if (!triggerDate) return false;
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: `${satelliteName} pass starting soon`,
        body: `Rises in ${minutesBefore} min, peaks at ${pass.maxElevationDeg.toFixed(0)}° elevation. Open Azimuth to capture it.`,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate },
    });
    storage.set(passId, id);
    return true;
  },

  async cancel(passId: string): Promise<void> {
    const id = storage.getString(passId);
    if (id) await Notifications.cancelScheduledNotificationAsync(id);
    storage.remove(passId);
  },
};
