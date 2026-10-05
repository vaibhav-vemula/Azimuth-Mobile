import SignalScanModule from './src/SignalScanModule';
import type { OrientationListener, ScanCapabilities, ScanResult, SignalScanSubscription } from './src/SignalScanModule.types';

export * from './src/SignalScanModule.types';

export function getCapabilities(): Promise<ScanCapabilities> {
  return SignalScanModule.getCapabilities();
}

/** Starts the foreground service (visible notification) and GNSS monitoring. */
export function startMapping(): Promise<void> {
  return SignalScanModule.startMapping();
}

export function stopMapping(): Promise<void> {
  return SignalScanModule.stopMapping();
}

/**
 * One reading of cellular, Wi-Fi, optional Bluetooth (about 2 s) and the latest GNSS quality. Pass a venue tag's
 * advertised-name prefix to learn whether that tag was heard.
 */
export function scan(includeBluetooth: boolean, beaconPrefix: string | null = null): Promise<ScanResult> {
  return SignalScanModule.scan(includeBluetooth, beaconPrefix);
}

/** Starts streaming the phone's orientation (for AR). Rejects if the phone has no rotation sensor. */
export function startOrientation(latitude: number, longitude: number): Promise<void> {
  return SignalScanModule.startOrientation(latitude, longitude);
}

export function stopOrientation(): Promise<void> {
  return SignalScanModule.stopOrientation();
}

export function addOrientationListener(listener: OrientationListener): SignalScanSubscription {
  return SignalScanModule.addListener('onOrientation', listener);
}

export default SignalScanModule;
