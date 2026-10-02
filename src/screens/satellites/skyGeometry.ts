export interface PolarPoint {
  x: number;
  y: number;
}

/**
 * Projects azimuth/elevation onto a polar chart: the horizon is the outer circle, the zenith the centre,
 * north is up and east is to the right.
 */
export function polarPoint(azimuthDeg: number, elevationDeg: number, radius: number, cx = 0, cy = 0): PolarPoint {
  const clamped = Math.max(0, Math.min(90, elevationDeg));
  const r = ((90 - clamped) / 90) * radius;
  const az = (azimuthDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(az), y: cy - r * Math.cos(az) };
}
