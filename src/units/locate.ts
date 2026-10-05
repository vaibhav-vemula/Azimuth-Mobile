import * as Location from 'expo-location';
import { useUnits } from './units';

/**
 * Works out the country at launch from the phone's last known position, so "Automatic" units are right straight away
 * and not only after the Map tab has found a fix. Only looks if location permission was already given; never asks.
 */
export async function initUnitsFromLocation(): Promise<void> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) return;
    const last = await Location.getLastKnownPositionAsync();
    if (last) useUnits.getState().noteLocation(last.coords.latitude, last.coords.longitude);
  } catch {
    // No position yet: the phone's region setting is used until there is one.
  }
}
