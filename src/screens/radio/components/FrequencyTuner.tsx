import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassCard } from '../../../components/GlassCard';
import { Button, Row, SectionLabel } from '../../../components/ui';
import { errorMessage, useReceiver } from '../../../receiver/useReceiver';
import { colors, typography } from '../../../theme';
import { formatFrequencyMHz } from '../../../utils/format';
import { parseFrequencyMHz } from '../../../utils/frequencyInput';

const PRESETS = [
  { label: '88.5', hz: 88_500_000 },
  { label: '93.9', hz: 93_900_000 },
  { label: '98.7', hz: 98_700_000 },
  { label: '103.5', hz: 103_500_000 },
];
const STEPS = [
  { label: '−1', deltaHz: -1_000_000 },
  { label: '−0.1', deltaHz: -100_000 },
  { label: '+0.1', deltaHz: 100_000 },
  { label: '+1', deltaHz: 1_000_000 },
];
const FEEDBACK_MS = 2500;

type Feedback = { kind: 'ok' | 'error'; message: string } | null;

/**
 * Frequency entry. It owns its own text, so spectrum frames and status updates elsewhere on the screen can
 * never reset what is being typed, and it only syncs from the receiver when you are not editing.
 */
function FrequencyTunerComponent({ disabled }: { disabled: boolean }) {
  const frequencyHz = useReceiver((s) => s.frequencyHz);
  const [text, setText] = useState(() => formatFrequencyMHz(frequencyHz));
  const [focused, setFocused] = useState(false);
  const [tuning, setTuning] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
  }, []);

  // Follow the receiver (presets, other screens, a retune) unless the user is in the middle of typing.
  useEffect(() => {
    if (!focused) setText(formatFrequencyMHz(frequencyHz));
  }, [frequencyHz, focused]);

  const showFeedback = useCallback((next: Feedback) => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setFeedback(next);
    if (next?.kind === 'ok') clearTimer.current = setTimeout(() => setFeedback(null), FEEDBACK_MS);
  }, []);

  const tuneToHz = useCallback(
    async (hz: number) => {
      setTuning(true);
      try {
        await useReceiver.getState().tuneTo(hz);
        setText(formatFrequencyMHz(hz));
        showFeedback({ kind: 'ok', message: `Tuned to ${formatFrequencyMHz(hz)} MHz` });
      } catch (e) {
        showFeedback({ kind: 'error', message: errorMessage(e) });
      } finally {
        setTuning(false);
      }
    },
    [showFeedback]
  );

  const submit = useCallback(() => {
    Keyboard.dismiss();
    const parsed = parseFrequencyMHz(text);
    if (!parsed.ok) {
      showFeedback({ kind: 'error', message: parsed.message });
      return;
    }
    void tuneToHz(parsed.hz);
  }, [text, showFeedback, tuneToHz]);

  const step = useCallback(
    (deltaHz: number) => {
      const next = useReceiver.getState().frequencyHz + deltaHz;
      void tuneToHz(next);
    },
    [tuneToHz]
  );

  return (
    <GlassCard style={{ gap: 12 }}>
      <SectionLabel>Tune</SectionLabel>
      <Row>
        <View style={[styles.inputWrap, focused && styles.inputWrapFocused, feedback?.kind === 'error' && styles.inputWrapError]}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={(value) => {
              setText(value);
              if (feedback?.kind === 'error') setFeedback(null);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            keyboardType="decimal-pad"
            placeholder="100.000"
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.accent}
            selectTextOnFocus
            editable={!disabled}
            returnKeyType="done"
            onSubmitEditing={submit}
            accessibilityLabel="Frequency in megahertz"
          />
          <Text style={styles.inputUnit}>MHz</Text>
        </View>
        <Button label="Tune" onPress={submit} loading={tuning} disabled={disabled} />
      </Row>

      <Row style={{ justifyContent: 'space-between' }}>
        {STEPS.map((s) => (
          <Button key={s.label} compact variant="secondary" label={s.label} disabled={disabled || tuning} onPress={() => step(s.deltaHz)} style={styles.stepButton} />
        ))}
      </Row>

      <Row style={{ flexWrap: 'wrap' }}>
        {PRESETS.map((preset) => (
          <Button key={preset.label} compact variant="ghost" label={preset.label} disabled={disabled || tuning} onPress={() => void tuneToHz(preset.hz)} />
        ))}
      </Row>

      <View style={styles.feedbackRow}>
        {feedback ? (
          <>
            <Ionicons name={feedback.kind === 'ok' ? 'checkmark-circle' : 'alert-circle'} size={16} color={feedback.kind === 'ok' ? colors.success : colors.danger} />
            <Text style={[styles.feedback, { color: feedback.kind === 'ok' ? colors.success : colors.danger }]}>{feedback.message}</Text>
          </>
        ) : (
          <Text style={styles.hint}>Type a frequency in MHz and press Tune, or use the step buttons. Below 28.8 MHz the V4 upconverter is used.</Text>
        )}
      </View>
    </GlassCard>
  );
}

export const FrequencyTuner = memo(FrequencyTunerComponent);

const styles = StyleSheet.create({
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    paddingHorizontal: 14,
  },
  inputWrapFocused: { borderColor: colors.accent },
  inputWrapError: { borderColor: colors.danger },
  input: { flex: 1, ...typography.subheading, fontSize: 20, color: colors.textPrimary, paddingVertical: 11, fontVariant: ['tabular-nums'] },
  inputUnit: { ...typography.caption, color: colors.textSecondary, marginLeft: 8 },
  stepButton: { flex: 1 },
  feedbackRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 20 },
  feedback: { ...typography.caption, flex: 1 },
  hint: { ...typography.caption, color: colors.textTertiary, flex: 1 },
});
