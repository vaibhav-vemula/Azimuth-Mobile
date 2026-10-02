import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { useCapture } from './src/capture/useCapture';
import { useReceiver } from './src/receiver/useReceiver';
import { colors, useAppFonts } from './src/theme';

export default function App() {
  const { fontsLoaded } = useAppFonts();

  useEffect(() => {
    useReceiver.getState().init();
    useCapture.getState().init();
  }, []);

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <RootNavigator />
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
