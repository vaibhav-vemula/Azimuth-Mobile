import { useFonts, SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';

export function useAppFonts() {
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });
  return { fontsLoaded };
}

export const typography = {
  display: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 34, letterSpacing: -0.5 },
  heading: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 22 },
  subheading: { fontFamily: 'SpaceGrotesk_500Medium', fontSize: 16 },
  body: { fontFamily: 'SpaceGrotesk_400Regular', fontSize: 14 },
  caption: { fontFamily: 'SpaceGrotesk_400Regular', fontSize: 12 },
  label: { fontFamily: 'SpaceGrotesk_500Medium', fontSize: 11, letterSpacing: 1.4 },
} as const;
