import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Badge, Button, SectionLabel } from '../../../../components/ui';
import { getCapabilities } from '../../../../../modules/signal-scan';
import { useCapture } from '../../../../capture/useCapture';
import { useChests } from '../../../../network/useChests';
import { useSubmission } from '../../../../network/useSubmission';
import { verifierConfigured } from '../../../../network/config';
import { buildPassReceipt } from '../../../../reports/passReport';
import { useAppStore } from '../../../../state/useAppStore';
import { colors, typography } from '../../../../theme';
import { useWallet } from '../../../../wallet/useWallet';

/**
 * After a real pass is recorded: a signed receipt that goes to the verifier, which checks the claim against
 * the satellite's orbit. If an open satellite chest matches, the same receipt claims it.
 */
export function PassReceiptCard() {
  const options = useCapture((s) => s.options);
  const plan = useCapture((s) => s.plan);
  const result = useCapture((s) => s.result);
  const testRun = useCapture((s) => s.testRun);
  const observer = useAppStore((s) => s.location);
  const address = useWallet((s) => s.address);
  const chests = useChests((s) => s.chests);
  const { state, submit } = useSubmission();

  const chest = useMemo(
    () => chests.find((c) => c.kind === 'satellite-pass' && (!c.spec.noradId || String(c.spec.noradId) === options?.pass.noradId)),
    [chests, options]
  );

  if (!options || !plan || !result) return null;

  let reason: string | null = null;
  if (testRun) reason = 'This was a test run outside a real pass, so it cannot be submitted.';
  else if (result.error) reason = 'The recording stopped early, so it cannot be submitted.';
  else if (!observer) reason = 'Set your location in Settings to submit a receipt.';
  else if (!address) reason = 'Connect a wallet in Profile to sign a receipt.';
  else if (!verifierConfigured) reason = 'This build is not connected to the network.';

  const send = async () => {
    if (!observer || !address) return;
    const caps = await getCapabilities().catch(() => null);
    const report = buildPassReceipt({
      node: address,
      device: { model: caps?.model ?? 'unknown', app: Constants.expoConfig?.version ?? '1.0.0' },
      observer,
      noradId: options.pass.noradId,
      riseMs: options.pass.riseTime.getTime(),
      setMs: options.pass.setTime.getTime(),
      maxElevationDeg: options.pass.maxElevationDeg,
      frequencyHz: plan.frequencyHz,
      gainDb: plan.gainDb,
      signalSnrDb: plan.signalSnrDb,
      format: result.format,
      bytes: result.bytes,
      samples: result.samples,
      droppedBlocks: result.droppedBlocks,
      chest: chest ? { id: chest.id, cellId: chest.cellId } : undefined,
    });
    await submit(report);
  };

  return (
    <View style={styles.box}>
      <SectionLabel>Pass receipt</SectionLabel>
      <Text style={styles.note}>
        A signed statement that you recorded this pass. The verifier checks it against the satellite's orbit. The recording itself is not uploaded.
      </Text>
      {chest ? <Badge label={`Claims chest: ${chest.title}`} color={colors.accent} /> : null}
      {state.phase === 'done' ? (
        <>
          <Badge label={state.pending ? 'Submitted for review' : state.accepted ? 'Accepted' : 'Not accepted'} color={state.accepted ? (state.pending ? colors.accent : colors.success) : colors.danger} />
          <Text style={styles.note}>{state.message}</Text>
        </>
      ) : (
        <>
          {reason ? <Text style={styles.note}>{reason}</Text> : null}
          {state.phase === 'error' ? <Text style={[styles.note, { color: colors.danger }]}>{state.message}</Text> : null}
          <Button
            label={state.phase === 'signing' ? 'Waiting for wallet…' : state.phase === 'sending' ? 'Sending…' : 'Sign and submit receipt'}
            icon="shield-checkmark-outline"
            disabled={!!reason}
            loading={state.phase === 'signing' || state.phase === 'sending'}
            onPress={() => void send()}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8, borderTopWidth: 1, borderTopColor: colors.surfaceBorder, paddingTop: 12 },
  note: { ...typography.caption, color: colors.textSecondary },
});
