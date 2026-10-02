import { memo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '../../../../components/GlassCard';
import { SectionLabel } from '../../../../components/ui';
import { SetupPlan, SetupProgress } from '../../../../capture/autoSetup';
import { AutoSetupStatus } from '../../../../capture/autoSetupStore';
import { colors, typography } from '../../../../theme';
import { formatFrequencyMHz } from '../../../../utils/format';
import { SignalAnalysis } from '../../../../utils/signal';

type StepState = 'done' | 'active' | 'waiting' | 'pending' | 'warn';

interface Step {
  key: string;
  state: StepState;
  title: string;
  detail: string;
}

const GAIN_REASON: Record<SetupPlan['gainReason'], string> = {
  signal: 'tuned on the live signal',
  'noise-floor': 'lowest gain that fills the receiver cleanly',
  quiet: 'quiet surroundings, highest safe gain',
  overload: 'strong interference nearby, kept low to avoid overload',
};

const FREQUENCY_SOURCE: Record<SetupPlan['frequencySource'], string> = {
  signal: 'signal detected here',
  satnogs: 'where recent observations succeed',
  default: 'usual downlink',
};

export interface ChecklistInput {
  connected: boolean;
  deviceName: string | null;
  status: AutoSetupStatus;
  progress: SetupProgress | null;
  plan: SetupPlan | null;
  analysis: SignalAnalysis | null;
  error: string | null;
}

export function buildSteps(input: ChecklistInput): Step[] {
  const { connected, deviceName, status, progress, plan, analysis, error } = input;
  const working = status === 'working';

  const receiver: Step = connected
    ? { key: 'receiver', state: 'done', title: 'Receiver', detail: deviceName ?? 'Connected' }
    : { key: 'receiver', state: 'pending', title: 'Receiver', detail: 'Not connected' };

  const frequency: Step = plan
    ? { key: 'frequency', state: 'done', title: 'Frequency', detail: `${formatFrequencyMHz(plan.frequencyHz)} MHz · ${FREQUENCY_SOURCE[plan.frequencySource]}` }
    : connected && working && (!progress || progress.step === 'frequency')
      ? { key: 'frequency', state: 'active', title: 'Frequency', detail: 'Looking for the downlink on 137.1 and 137.9 MHz' }
      : { key: 'frequency', state: 'pending', title: 'Frequency', detail: 'Chosen automatically' };

  const probe = progress?.probe;
  const gain: Step = plan
    ? { key: 'gain', state: 'done', title: 'Gain', detail: `${plan.gainDb.toFixed(1)} dB · ${GAIN_REASON[plan.gainReason]}` }
    : connected && working && progress && progress.step !== 'frequency'
      ? {
          key: 'gain',
          state: 'active',
          title: 'Gain',
          detail: probe ? `Testing ${probe.gainDb.toFixed(1)} dB (${probe.index + 1} of ${probe.total})` : progress.message,
        }
      : { key: 'gain', state: 'pending', title: 'Gain', detail: 'Optimised automatically' };

  let signal: Step;
  if (!plan) {
    signal = { key: 'signal', state: 'pending', title: 'Signal', detail: 'Checked after set-up' };
  } else if (analysis?.verdict === 'lrpt') {
    signal = { key: 'signal', state: 'done', title: 'Signal', detail: `LRPT signal found, ${analysis.snrDb.toFixed(1)} dB above the noise` };
  } else if (analysis?.verdict === 'narrow' || analysis?.verdict === 'wide') {
    signal = { key: 'signal', state: 'warn', title: 'Signal', detail: 'Interference nearby, not the satellite' };
  } else {
    signal = { key: 'signal', state: 'waiting', title: 'Signal', detail: 'Waiting for the satellite to rise' };
  }

  if (status === 'error') {
    const failing = [receiver, frequency, gain, signal].find((s) => s.state !== 'done');
    if (failing) {
      failing.state = 'warn';
      failing.detail = error ?? 'Automatic set-up failed';
    }
  }
  return [receiver, frequency, gain, signal];
}

function StepIcon({ state }: { state: StepState }) {
  switch (state) {
    case 'done':
      return <Ionicons name="checkmark-circle" size={22} color={colors.success} />;
    case 'active':
      return <ActivityIndicator size="small" color={colors.accent} />;
    case 'waiting':
      return <Ionicons name="hourglass-outline" size={20} color={colors.warning} />;
    case 'warn':
      return <Ionicons name="alert-circle" size={22} color={colors.danger} />;
    default:
      return <Ionicons name="ellipse-outline" size={20} color={colors.textTertiary} />;
  }
}

function SetupChecklistComponent(props: ChecklistInput) {
  const steps = buildSteps(props);
  return (
    <GlassCard style={{ gap: 14 }}>
      <SectionLabel>Automatic set-up</SectionLabel>
      {steps.map((step, i) => (
        <View key={step.key} style={styles.row}>
          <View style={styles.iconColumn}>
            <View style={styles.icon}>
              <StepIcon state={step.state} />
            </View>
            {i < steps.length - 1 ? <View style={[styles.line, step.state === 'done' && styles.lineDone]} /> : null}
          </View>
          <View style={styles.text}>
            <Text style={[styles.title, step.state === 'pending' && { color: colors.textTertiary }]}>{step.title}</Text>
            <Text style={[styles.detail, step.state === 'warn' && { color: colors.danger }, step.state === 'waiting' && { color: colors.warning }]}>
              {step.detail}
            </Text>
          </View>
        </View>
      ))}
    </GlassCard>
  );
}

export const SetupChecklist = memo(SetupChecklistComponent);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  iconColumn: { alignItems: 'center', width: 24 },
  icon: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  line: { flex: 1, width: 2, backgroundColor: colors.surfaceBorder, marginTop: 4, marginBottom: -14, borderRadius: 1 },
  lineDone: { backgroundColor: 'rgba(102,187,106,0.5)' },
  text: { flex: 1, paddingBottom: 2 },
  title: { ...typography.subheading, fontSize: 15, color: colors.textPrimary },
  detail: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
});
