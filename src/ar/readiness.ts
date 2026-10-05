import type { Chest } from '../network/api';

export const DEFAULT_MIN_SAMPLES = 3;

export interface Readiness {
  /** Everything needed to open the chest is in place. */
  ready: boolean;
  /** One line telling the player what is missing, or that they can open it. */
  hint: string;
  needed: number;
  have: number;
}

/** Whether a chest can be opened right now, and if not what is missing. Pure, so it is easy to test. */
export function readinessOf(input: {
  chest: Chest;
  mappingRunning: boolean;
  hasWallet: boolean;
  /** Readings recorded in or next to the chest's cell this session. */
  have: number;
  /** Dongle readings (or sonde detections) near the chest this session. */
  radioHave: number;
}): Readiness {
  const { chest, mappingRunning, hasWallet, have, radioHave } = input;
  const needed = chest.spec.minSamples ?? DEFAULT_MIN_SAMPLES;
  const dongleOnly = chest.requires === 'dongle';
  const sonde = chest.kind === 'sonde';

  if (chest.kind === 'satellite-pass') {
    return { ready: false, needed, have, hint: 'Record the pass from the Satellites tab. The receipt you sign afterwards claims this chest.' };
  }
  // A test chest only exists on this phone, so it needs no wallet.
  if (!hasWallet && chest.spec.test !== true) return { ready: false, needed, have, hint: 'Connect a wallet in Profile to open chests.' };
  if (!mappingRunning) return { ready: false, needed, have, hint: 'Start mapping on the Map tab, then walk to this chest.' };
  if (have < needed) return { ready: false, needed, have, hint: `Readings near the chest: ${have} of ${needed}. Keep walking toward it.` };
  if (dongleOnly && radioHave < 1) {
    return {
      ready: false,
      needed,
      have,
      hint: sonde
        ? `Listening for the sonde on ${((chest.spec.frequencyHz ?? 0) / 1e6).toFixed(3)} MHz. Walk toward the landing area with the antenna up.`
        : 'Waiting for a dongle reading. Plug in the RTL-SDR with an antenna and stay nearby.',
    };
  }
  return { ready: true, needed, have, hint: 'Ready to open.' };
}

