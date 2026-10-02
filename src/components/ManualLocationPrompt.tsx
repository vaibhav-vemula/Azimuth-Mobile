import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Platform } from 'react-native';
import { colors, typography } from '../theme';

export function ManualLocationPrompt({ onSubmit }: { onSubmit: (lat: number, lon: number) => void }) {
  const [latText, setLatText] = useState('');
  const [lonText, setLonText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    if (!latText.trim() || !lonText.trim()) {
      setError('Enter both latitude and longitude.');
      return;
    }
    const lat = Number(latText);
    const lon = Number(lonText);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setError('Latitude must be a number between -90 and 90.');
      return;
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      setError('Longitude must be a number between -180 and 180.');
      return;
    }
    setError(null);
    onSubmit(lat, lon);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Enter your location manually:</Text>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder="Latitude"
          placeholderTextColor={colors.textSecondary}
          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
          value={latText}
          onChangeText={setLatText}
        />
        <TextInput
          style={styles.input}
          placeholder="Longitude"
          placeholderTextColor={colors.textSecondary}
          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
          value={lonText}
          onChangeText={setLonText}
        />
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={styles.button} onPress={handleSubmit}>
        <Text style={styles.buttonLabel}>Use this location</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 12 },
  label: { ...typography.caption, color: colors.textSecondary, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderColor: colors.surfaceBorder,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  error: { ...typography.caption, color: colors.danger, marginTop: 6 },
  button: { backgroundColor: colors.accentMuted, borderRadius: 10, padding: 10, alignItems: 'center', marginTop: 10 },
  buttonLabel: { ...typography.caption, color: colors.textPrimary },
});
