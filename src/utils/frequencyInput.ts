import { MAX_FREQUENCY_HZ, MIN_FREQUENCY_HZ } from '../../modules/rtl-sdr';

export type ParsedFrequency = { ok: true; hz: number } | { ok: false; message: string };

/** Parses what the user typed into the MHz box. Accepts "98.7", "98,7" and stray spaces. */
export function parseFrequencyMHz(text: string): ParsedFrequency {
  const cleaned = text.trim().replace(',', '.');
  if (cleaned === '') return { ok: false, message: 'Enter a frequency in MHz.' };
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return { ok: false, message: 'Use numbers only, for example 98.7.' };

  const hz = Math.round(Number.parseFloat(cleaned) * 1e6);
  if (!Number.isFinite(hz)) return { ok: false, message: 'Enter a frequency in MHz.' };
  if (hz < MIN_FREQUENCY_HZ || hz > MAX_FREQUENCY_HZ) {
    return {
      ok: false,
      message: `The receiver covers ${(MIN_FREQUENCY_HZ / 1e6).toFixed(1)} to ${(MAX_FREQUENCY_HZ / 1e6).toFixed(0)} MHz.`,
    };
  }
  return { ok: true, hz };
}
