import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { useCapture } from './src/capture/useCapture';
import { useReceiver } from './src/receiver/useReceiver';
import { colors, useAppFonts } from './src/theme';
import { SplashScreen } from './src/screens/onboarding/SplashScreen';
import { ConnectScreen } from './src/screens/onboarding/ConnectScreen';
import { useWallet } from './src/wallet/useWallet';
import { useMapping } from './src/mapping/useMapping';
import { initBackup } from './src/backup/useBackup';

export default function App() {
  const { fontsLoaded } = useAppFonts();
  const [splashDone, setSplashDone] = useState(false);
  const onSplashDone = useCallback(() => setSplashDone(true), []);
  const walletConnected = useWallet((s) => s.status === 'connected');
  const guest = useWallet((s) => s.guest);

  useEffect(() => {
    useReceiver.getState().init();
    useCapture.getState().init();
    useWallet.getState().restore();
    useMapping.getState().load();
    initBackup();
  }, []);

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const showConnect = splashDone && !walletConnected && !guest;

  return (
    <SafeAreaProvider>
      {!splashDone ? <SplashScreen onDone={onSplashDone} /> : showConnect ? <ConnectScreen /> : <RootNavigator />}
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
