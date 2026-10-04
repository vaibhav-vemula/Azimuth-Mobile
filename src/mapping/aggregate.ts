import type { ScanResult } from '../../modules/signal-scan';
import type { RadioReading, SondeReading } from './radio';

/** A scan from the phone, optionally with a dongle reading taken at the same moment. */
export type MappedScan = ScanResult & { radio?: RadioReading; sonde?: SondeReading; beaconName?: string };

/** Time buckets round exact times so an exact time plus an exact place cannot rebuild one person's trail. */
export const BUCKET_MINUTES = 15;

export function bucketStartMs(atMs: number, minutes = BUCKET_MINUTES): number {
  const size = minutes * 60_000;
  return Math.floor(atMs / size) * size;
}

/** What one cell holds for one time bucket. Counts and levels only. */
export interface CellBucket {
  cellId: string;
  bucketStartMs: number;
  samples: number;
  cellular: {
    /** Samples in which at least one cell was visible. */
    seen: number;
    /** Samples with no cell at all. */
    none: number;
    /** Strongest cell dBm, summed so the mean can be formed later. */
    bestDbmSum: number;
    bestDbmMin: number;
    bestDbmMax: number;
    maxCells: number;
    techs: string[];
  };
  wifi: { samples: number; countSum: number; countMax: number; strongestDbmMax: number | null };
  bluetooth: { samples: number; countSum: number; countMax: number };
  gnss: { samples: number; cn0Sum: number; usedSum: number };
  /** A venue tag the app was told to listen for; counts how often it was heard. */
  beacon?: { name: string; samples: number; seen: number; rssiMax: number };
  /** Listening for a specific radiosonde frequency near its last known position. */
  sonde?: { frequencyHz: number; samples: number; detected: number; peakDbMax: number; rmsMax: number; clipMax: number; gainDb: number };
  /** Dongle readings, present only when the user mapped with a dongle. */
  radio?: { samples: number; carriers: number; peakDbSum: number; peakDbMax: number; rmsSum: number; rmsMax: number; clipMax: number; gainDb: number };
}

export function emptyBucket(cellId: string, bucket: number): CellBucket {
  return {
    cellId,
    bucketStartMs: bucket,
    samples: 0,
    cellular: { seen: 0, none: 0, bestDbmSum: 0, bestDbmMin: 0, bestDbmMax: -200, maxCells: 0, techs: [] },
    wifi: { samples: 0, countSum: 0, countMax: 0, strongestDbmMax: null },
    bluetooth: { samples: 0, countSum: 0, countMax: 0 },
    gnss: { samples: 0, cn0Sum: 0, usedSum: 0 },
  };
}

/** Adds one scan to a bucket in place. */
export function addScan(bucket: CellBucket, scan: MappedScan): void {
  bucket.samples += 1;

  if (scan.cellular.available) {
    const cells = scan.cellular.cells;
    if (cells.length === 0) {
      bucket.cellular.none += 1;
    } else {
      const best = Math.max(...cells.map((c) => c.dbm));
      const c = bucket.cellular;
      c.seen += 1;
      c.bestDbmSum += best;
      c.bestDbmMin = c.seen === 1 ? best : Math.min(c.bestDbmMin, best);
      c.bestDbmMax = Math.max(c.bestDbmMax, best);
      c.maxCells = Math.max(c.maxCells, cells.length);
      for (const cell of cells) if (!c.techs.includes(cell.tech)) c.techs.push(cell.tech);
    }
  }

  if (scan.wifi.available && typeof scan.wifi.count === 'number') {
    const w = bucket.wifi;
    w.samples += 1;
    w.countSum += scan.wifi.count;
    w.countMax = Math.max(w.countMax, scan.wifi.count);
    if (typeof scan.wifi.strongestDbm === 'number') {
      w.strongestDbmMax = w.strongestDbmMax === null ? scan.wifi.strongestDbm : Math.max(w.strongestDbmMax, scan.wifi.strongestDbm);
    }
  }

  if (scan.bluetooth?.available && typeof scan.bluetooth.count === 'number') {
    const b = bucket.bluetooth;
    b.samples += 1;
    b.countSum += scan.bluetooth.count;
    b.countMax = Math.max(b.countMax, scan.bluetooth.count);
  }

  if (scan.beaconName && scan.bluetooth?.available) {
    const b = (bucket.beacon ??= { name: scan.beaconName, samples: 0, seen: 0, rssiMax: -127 });
    if (b.name === scan.beaconName) {
      b.samples += 1;
      if (scan.bluetooth.beaconSeen) {
        b.seen += 1;
        b.rssiMax = Math.max(b.rssiMax, scan.bluetooth.beaconRssi ?? -127);
      }
    }
  }

  if (scan.sonde) {
    const r = (bucket.sonde ??= { frequencyHz: scan.sonde.frequencyHz, samples: 0, detected: 0, peakDbMax: 0, rmsMax: 0, clipMax: 0, gainDb: scan.sonde.gainDb });
    if (r.frequencyHz === scan.sonde.frequencyHz) {
      r.samples += 1;
      if (scan.sonde.detected) r.detected += 1;
      r.peakDbMax = Math.max(r.peakDbMax, scan.sonde.peakDb);
      r.rmsMax = Math.max(r.rmsMax, scan.sonde.rms);
      r.clipMax = Math.max(r.clipMax, scan.sonde.clip);
    }
  }

  if (scan.radio) {
    const r = (bucket.radio ??= { samples: 0, carriers: 0, peakDbSum: 0, peakDbMax: 0, rmsSum: 0, rmsMax: 0, clipMax: 0, gainDb: scan.radio.gainDb });
    r.samples += 1;
    if (scan.radio.carrier) r.carriers += 1;
    r.peakDbSum += scan.radio.peakDb;
    r.peakDbMax = Math.max(r.peakDbMax, scan.radio.peakDb);
    r.rmsSum += scan.radio.rms;
    r.rmsMax = Math.max(r.rmsMax, scan.radio.rms);
    r.clipMax = Math.max(r.clipMax, scan.radio.clip);
  }

  if (typeof scan.gnss.avgCn0Used === 'number') {
    bucket.gnss.samples += 1;
    bucket.gnss.cn0Sum += scan.gnss.avgCn0Used;
    bucket.gnss.usedSum += scan.gnss.used ?? 0;
  }
}

export function bucketKey(cellId: string, bucket: number): string {
  return `${cellId}@${bucket}`;
}

/** Derived, human-facing numbers for one bucket (or several merged). */
export interface CellSummary {
  samples: number;
  cellularCoverage: number | null; // 0..1 share of samples with a cell
  cellularMeanDbm: number | null;
  wifiMeanCount: number | null;
  bluetoothMeanCount: number | null;
  gnssMeanCn0: number | null;
  /** Share of dongle readings in which a NOAA carrier was received. */
  noaaReception: number | null;
}

export function summarize(buckets: CellBucket[]): CellSummary {
  let samples = 0;
  let seen = 0;
  let none = 0;
  let dbm = 0;
  let wifiSamples = 0;
  let wifiSum = 0;
  let btSamples = 0;
  let btSum = 0;
  let gnssSamples = 0;
  let gnssSum = 0;
  let radioSamples = 0;
  let radioCarriers = 0;
  for (const b of buckets) {
    if (b.radio) {
      radioSamples += b.radio.samples;
      radioCarriers += b.radio.carriers;
    }
    samples += b.samples;
    seen += b.cellular.seen;
    none += b.cellular.none;
    dbm += b.cellular.bestDbmSum;
    wifiSamples += b.wifi.samples;
    wifiSum += b.wifi.countSum;
    btSamples += b.bluetooth.samples;
    btSum += b.bluetooth.countSum;
    gnssSamples += b.gnss.samples;
    gnssSum += b.gnss.cn0Sum;
  }
  const cellSamples = seen + none;
  return {
    samples,
    cellularCoverage: cellSamples > 0 ? seen / cellSamples : null,
    cellularMeanDbm: seen > 0 ? dbm / seen : null,
    wifiMeanCount: wifiSamples > 0 ? wifiSum / wifiSamples : null,
    bluetoothMeanCount: btSamples > 0 ? btSum / btSamples : null,
    gnssMeanCn0: gnssSamples > 0 ? gnssSum / gnssSamples : null,
    noaaReception: radioSamples > 0 ? radioCarriers / radioSamples : null,
  };
}
