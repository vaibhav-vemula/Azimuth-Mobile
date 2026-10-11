import { ComponentType } from 'react';
import { InteractionManager } from 'react-native';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { ErrorBoundary } from '../components/ErrorBoundary';
import RadioScreen from '../screens/radio/RadioScreen';
import PassesScreen from '../screens/satellites/PassesScreen';
import PassDetailScreen from '../screens/satellites/PassDetailScreen';
import CaptureScreen from '../screens/satellites/CaptureScreen';
import SondeHuntScreen from '../screens/satellites/SondeHuntScreen';
import RecordingsScreen from '../screens/recordings/RecordingsScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import QuestsScreen from '../screens/quests/QuestsScreen';
import SettingsScreen from '../screens/settings/SettingsScreen';
import { colors, typography } from '../theme';
import MapScreen from '../screens/map/MapScreen';
import { ProfileStackParamList, RootTabParamList, SatellitesStackParamList } from './types';

const Tab = createBottomTabNavigator<RootTabParamList>();
const Stack = createNativeStackNavigator<SatellitesStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();

const TAB_ICONS: Record<keyof RootTabParamList, { active: keyof typeof Ionicons.glyphMap; idle: keyof typeof Ionicons.glyphMap }> = {
  Map: { active: 'map', idle: 'map-outline' },
  Radio: { active: 'radio', idle: 'radio-outline' },
  Satellites: { active: 'planet', idle: 'planet-outline' },
  Quests: { active: 'trophy', idle: 'trophy-outline' },
  Profile: { active: 'person', idle: 'person-outline' },
};

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.backgroundElevated,
    primary: colors.accent,
    text: colors.textPrimary,
    border: colors.surfaceBorder,
  },
};

/** Wraps a screen so an unexpected render error shows a fallback instead of taking the whole app down. */
function guarded<P extends object>(Component: ComponentType<P>): ComponentType<P> {
  function Guarded(props: P) {
    return (
      <ErrorBoundary>
        <Component {...props} />
      </ErrorBoundary>
    );
  }
  Guarded.displayName = `Guarded(${Component.displayName ?? Component.name})`;
  return Guarded;
}

const GuardedRadio = guarded(RadioScreen);
const GuardedPasses = guarded(PassesScreen);
const GuardedPassDetail = guarded(PassDetailScreen);
const GuardedCapture = guarded(CaptureScreen);
const GuardedSondeHunt = guarded(SondeHuntScreen);
const GuardedRecordings = guarded(RecordingsScreen);
const GuardedQuests = guarded(QuestsScreen);
const GuardedProfile = guarded(ProfileScreen);
const GuardedMap = guarded(MapScreen);
const GuardedSettings = guarded(SettingsScreen);

function SatellitesStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.backgroundElevated },
        headerTintColor: colors.accent,
        headerTitleStyle: { ...typography.subheading, color: colors.textPrimary },
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="Passes" component={GuardedPasses} options={{ headerShown: false }} />
      <Stack.Screen name="PassDetail" component={GuardedPassDetail} options={{ title: 'Pass details' }} />
      <Stack.Screen name="Capture" component={GuardedCapture} options={{ title: 'Capture', presentation: 'modal' }} />
      <Stack.Screen name="SondeHunt" component={GuardedSondeHunt} options={{ title: 'Find the sonde' }} />
    </Stack.Navigator>
  );
}

const stackScreenOptions = {
  headerStyle: { backgroundColor: colors.backgroundElevated },
  headerTintColor: colors.accent,
  headerTitleStyle: { ...typography.subheading, color: colors.textPrimary },
  contentStyle: { backgroundColor: colors.background },
  headerShadowVisible: false,
};

function ProfileStackNavigator() {
  return (
    <ProfileStack.Navigator screenOptions={stackScreenOptions}>
      <ProfileStack.Screen name="ProfileHome" component={GuardedProfile} options={{ headerShown: false }} />
      <ProfileStack.Screen name="Recordings" component={GuardedRecordings} options={{ title: 'Recordings' }} />
      <ProfileStack.Screen name="Settings" component={GuardedSettings} options={{ title: 'Settings' }} />
    </ProfileStack.Navigator>
  );
}

/** Tabs that are built quietly in the background once the first screen is up, so pressing them later is instant. */
const PRELOAD_ORDER: (keyof RootTabParamList)[] = ['Quests', 'Satellites', 'Profile', 'Radio'];
let preloadScheduled = false;
function preloadTabsLater(navigation: { preload: (...args: any[]) => void }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (preloadScheduled) return;
  preloadScheduled = true;
  InteractionManager.runAfterInteractions(() => {
    PRELOAD_ORDER.forEach((name, i) => {
      // One at a time with a gap, so building them never blocks a touch.
      setTimeout(() => {
        try {
          navigation.preload(name);
        } catch {
          // A tab that cannot be preloaded is simply built when first opened.
        }
      }, 1200 + i * 700);
    });
  });
}

export function RootNavigator() {
  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        screenListeners={({ navigation }) => ({ focus: () => preloadTabsLater(navigation) })}
        screenOptions={({ route }) => ({
          headerShown: false,
          // A tab you are not looking at stops redrawing, so the one you are on stays quick; a short fade replaces the hard cut.
          freezeOnBlur: true,
          animation: 'fade',
          tabBarStyle: { backgroundColor: colors.backgroundElevated, borderTopColor: colors.surfaceBorder },
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textSecondary,
          tabBarLabelStyle: { ...typography.caption, fontSize: 11 },
          tabBarIcon: ({ color, size, focused }: { color: string; size: number; focused: boolean }) => (
            <Ionicons name={focused ? TAB_ICONS[route.name].active : TAB_ICONS[route.name].idle} color={color} size={size} />
          ),
        })}
      >
        <Tab.Screen name="Map" component={GuardedMap} options={{ title: 'Explore' }} />
        <Tab.Screen name="Quests" component={GuardedQuests} />
        <Tab.Screen name="Satellites" component={SatellitesStack} />
        <Tab.Screen name="Radio" component={GuardedRadio} />
        <Tab.Screen name="Profile" component={ProfileStackNavigator} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
