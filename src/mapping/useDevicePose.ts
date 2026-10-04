import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';
import type { LatLon } from './hexGrid';

export type LocationPermission = 'unknown' | 'granted' | 'denied';

export interface DevicePose {
  position: LatLon | null;
  accuracyM: number | null;
  /** The phone reported this position as a mock location. */
  mocked: boolean;
  /** Compass heading in degrees from true north, when the phone has a compass. */
  heading: number | null;
  permission: LocationPermission;
  request: () => Promise<void>;
}

/**
 * Where the phone is and which way it faces, for showing on the map. Nothing is recorded: this is a live view only,
 * and it stops when `active` is false (for example when the Map tab is not showing).
 */
export function useDevicePose(active: boolean): DevicePose {
  const [permission, setPermission] = useState<LocationPermission>('unknown');
  const [position, setPosition] = useState<LatLon | null>(null);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [mocked, setMocked] = useState(false);

  const request = useCallback(async () => {
    const result = await Location.requestForegroundPermissionsAsync();
    setPermission(result.granted ? 'granted' : 'denied');
  }, []);

  // Learn the current permission without prompting.
  useEffect(() => {
    let cancelled = false;
    Location.getForegroundPermissionsAsync()
      .then((p) => !cancelled && setPermission(p.granted ? 'granted' : p.canAskAgain ? 'unknown' : 'denied'))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!active || permission !== 'granted') return;
    let cancelled = false;
    let posSub: Location.LocationSubscription | null = null;
    let headSub: Location.LocationSubscription | null = null;

    (async () => {
      try {
        const last = await Location.getLastKnownPositionAsync();
        if (last && !cancelled) {
          setPosition({ latitudeDeg: last.coords.latitude, longitudeDeg: last.coords.longitude });
          setAccuracyM(last.coords.accuracy);
        }
        posSub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 2 }, (loc) => {
          setPosition({ latitudeDeg: loc.coords.latitude, longitudeDeg: loc.coords.longitude });
          setAccuracyM(loc.coords.accuracy);
          setMocked(loc.mocked === true);
        });
        headSub = await Location.watchHeadingAsync((h) => {
          const value = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          setHeading(Number.isFinite(value) ? value : null);
        });
      } catch {
        // No fix yet, or no compass: the map simply shows less.
      }
      if (cancelled) {
        posSub?.remove();
        headSub?.remove();
      }
    })();

    return () => {
      cancelled = true;
      posSub?.remove();
      headSub?.remove();
    };
  }, [active, permission]);

  return { position, accuracyM, mocked, heading, permission, request };
}
