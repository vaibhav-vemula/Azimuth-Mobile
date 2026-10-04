import { PermissionsAndroid, Platform } from 'react-native';
import * as Location from 'expo-location';

export interface MappingPermissions {
  location: boolean;
  bluetooth: boolean;
  wifi: boolean;
}

/**
 * Asks for everything a mapping session can use. Location is required; Bluetooth and nearby-Wi-Fi are
 * optional, and mapping simply skips a sensor whose permission was refused.
 */
export async function requestMappingPermissions(): Promise<MappingPermissions> {
  const location = (await Location.requestForegroundPermissionsAsync()).granted;
  if (Platform.OS !== 'android') return { location, bluetooth: false, wifi: false };

  const sdk = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  let bluetooth = true;
  let wifi = true;
  if (sdk >= 31) {
    const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
    bluetooth = r === PermissionsAndroid.RESULTS.GRANTED;
  }
  if (sdk >= 33) {
    const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES);
    wifi = r === PermissionsAndroid.RESULTS.GRANTED;
  }
  return { location, bluetooth, wifi };
}
