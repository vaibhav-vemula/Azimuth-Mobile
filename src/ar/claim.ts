import { useCallback, useEffect, useMemo } from 'react';
import type { Chest } from '../network/api';
import { readinessOf } from './readiness';

export { DEFAULT_MIN_SAMPLES, readinessOf } from './readiness';
export type { Readiness } from './readiness';
import { useSubmission } from '../network/useSubmission';
import { useMapping } from '../mapping/useMapping';
import { useWallet } from '../wallet/useWallet';
import { useChests } from '../network/useChests';
import bs58 from 'bs58';
import { buildClaim, signAndSubmitClaim } from '../challenges/claim';
import { periodKey } from '../challenges/periods';
import { TREASURE_AZM, treasureChallengeId } from '../network/treasure';

/**
 * Everything the chest card and the AR view share about opening a chest: the live readiness, and the signed
 * submission. `scans` is read only so the readiness is recomputed whenever a new reading lands.
 */
export function useChestClaim(chest: Chest, mappingRunning: boolean, scans: number) {
  const readingsNear = useMapping((s) => s.readingsNear);
  const radioReadingsNear = useMapping((s) => s.radioReadingsNear);
  const sondeDetectionsNear = useMapping((s) => s.sondeDetectionsNear);
  const buildChestReport = useMapping((s) => s.buildChestReport);
  const address = useWallet((s) => s.address);
  const { state, submit, finishLocally, working, failLocally, reset } = useSubmission();

  const dongleOnly = chest.requires === 'dongle';
  const sonde = chest.kind === 'sonde';

  const have = useMemo(() => (mappingRunning ? readingsNear(chest.cellId) : 0), [mappingRunning, readingsNear, chest.cellId, scans]);
  const radioHave = useMemo(
    () => (mappingRunning && dongleOnly ? (sonde ? sondeDetectionsNear(chest.cellId) : radioReadingsNear(chest.cellId)) : 0),
    [mappingRunning, dongleOnly, sonde, radioReadingsNear, sondeDetectionsNear, chest.cellId, scans]
  );
  const readiness = readinessOf({ chest, mappingRunning, hasWallet: !!address, have, radioHave });

  // Once the chest has been opened and accepted, it leaves the map.
  const markOpened = useChests((s) => s.markOpened);
  useEffect(() => {
    if (state.phase === 'done' && state.accepted) markOpened(chest.id);
  }, [state, chest.id, markOpened]);

  /** Builds the report from the running session, signs it with the wallet and submits it. */
  const claim = useCallback(async () => {
    // A treasure chest pays AZM: the wallet signs a claim for its slot and the server sends the tokens.
    if (chest.spec.treasure !== undefined) {
      if (!address) return;
      reset();
      try {
        working('signing');
        const now = Date.now();
        const built = buildClaim(address, treasureChallengeId(chest.spec.treasure), periodKey('daily', now), now);
        const base64 = Buffer.from(bs58.decode(address)).toString('base64');
        const result = await signAndSubmitClaim(built, base64);
        if (!result.accepted) return failLocally(result.reasons?.[0] ?? 'The claim could not be sent.');
        finishLocally(`Chest opened. ${TREASURE_AZM} AZM is on its way to your wallet and arrives in a few seconds. If the server is offline it is sent when it is back.`);
      } catch (e) {
        failLocally(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    // Any other chest that lives only on this phone opens right here and sends nothing.
    if (chest.spec.test === true) {
      reset();
      finishLocally('Test chest opened. Nothing was submitted, and no reward is paid.');
      return;
    }
    if (!address) return;
    reset();
    const report = await buildChestReport(address, { id: chest.id, cellId: chest.cellId });
    if (report) await submit(report);
  }, [address, buildChestReport, chest.id, chest.cellId, chest.spec.test, chest.spec.treasure, finishLocally, working, failLocally, reset, submit]);

  return { ...readiness, state, claim, reset, passChest: chest.kind === 'satellite-pass', dongleOnly, hasWallet: !!address };
}
