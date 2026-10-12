import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { addOrientationListener, startOrientation, stopOrientation } from '../../modules/signal-scan';
import { smoothAngleDeg, walkingHeadingDeg } from '../ar/orientation';
import { useUnits } from '../units/units';
import { Course, activityFor, chooseHeading, compassNeedsCalibration, courseFrom, useHeadingStore } from './headingStore';
import type { LatLon } from './hexGrid';

/** The heading is refreshed this often (the sensor reports about 60 times a second; a screen needs far fewer). */
const HEADING_INTERVAL_MS = 50;
/** How much of each new reading is taken: lower is steadier, higher follows a turn faster. */
const HEADING_SMOOTHING = 0.35;

export type LocationPermission = 'unknown' | 'granted' | 'denied';

export interface DevicePose {
  position: LatLon | null;
  accuracyM: number | null;
  /** The phone reported this position as a mock location. */
  mocked: boolean;
  permission: LocationPermission;
  request: () => Promise<void>;
}

/**
 * Where the phone is, for showing on the map. Which way it faces is published separately (see headingStore). Nothing is recorded: this is a live view only,
 * and it stops when `active` is false (for example when the Map tab is not showing).
 */
export function useDevicePose(active: boolean): DevicePose {
  /** True once the rotation sensor is delivering, so the older compass reading is not needed. */
  const sensorHeadingRef = useRef(false);
  /** The direction of travel from the latest moving GPS fix: while you walk it replaces the compass. */
  const courseRef = useRef<Course | null>(null);
  const [permission, setPermission] = useState<LocationPermission>('unknown');
  const [position, setPosition] = useState<LatLon | null>(null);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const setHeading = useHeadingStore((s) => s.set);
  const setNeedsCalibration = useHeadingStore((s) => s.setNeedsCalibration);
  const setActivity = useHeadingStore((s) => s.setActivity);
  const [mocked, setMocked] = useState(false);
  const hasFix = position !== null;

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
          useUnits.getState().noteLocation(last.coords.latitude, last.coords.longitude);
          setAccuracyM(last.coords.accuracy);
        }
        posSub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 2 }, (loc) => {
          setPosition({ latitudeDeg: loc.coords.latitude, longitudeDeg: loc.coords.longitude });
          useUnits.getState().noteLocation(loc.coords.latitude, loc.coords.longitude);
          setActivity(activityFor(loc.coords.speed));
          courseRef.current = courseFrom(loc.coords.speed, loc.coords.heading, Date.now());
          setAccuracyM(loc.coords.accuracy);
          setMocked(loc.mocked === true);
        });
        // The older compass reading is only a fallback for phones without a rotation sensor; it is unreliable when the
        // phone is held upright.
        if (!sensorHeadingRef.current) {
          headSub = await Location.watchHeadingAsync((h) => {
            if (sensorHeadingRef.current) return;
            const value = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
            setHeading(Number.isFinite(value) ? value : null);
          });
        }
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

  // Heading from the rotation sensor: follows the phone as you turn it, flat or upright.
  const latest = useRef<LatLon | null>(null);
  latest.current = position;
  useEffect(() => {
    if (!active || permission !== 'granted' || !hasFix || !latest.current) return;
    let cancelled = false;
    let last = 0;
    let smoothed: number | null = null;
    const sub = addOrientationListener((e) => {
      const now = Date.now();
      if (now - last < HEADING_INTERVAL_MS) return;
      last = now;
      const compass = walkingHeadingDeg({ w: e.w, x: e.x, y: e.y, z: e.z }, e.declinationDeg);
      smoothed = smoothAngleDeg(smoothed, chooseHeading(compass, courseRef.current, now) ?? compass, HEADING_SMOOTHING);
      sensorHeadingRef.current = true;
      setNeedsCalibration(compassNeedsCalibration(e.status, e.accuracyRad));
      setHeading(smoothed);
    });
    startOrientation(latest.current.latitudeDeg, latest.current.longitudeDeg).catch(() => {
      if (!cancelled) {
        sensorHeadingRef.current = false;
      }
    });
    return () => {
      cancelled = true;
      sub.remove();
      void stopOrientation().catch(() => undefined);
    };
  }, [active, permission, hasFix]);

  return { position, accuracyM, mocked, permission, request };
}
