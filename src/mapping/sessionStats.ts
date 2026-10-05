import type { MappedScan } from './aggregate';

/** Everything counted over one mapping session, as plain numbers for the screen. */
export interface SessionTotals {
  /** Different cell towers heard so far, and how many of each kind. */
  towers: number;
  towersByTech: { lte: number; nr: number; wcdma: number; gsm: number };
  /** The tower the phone is connected to right now, if it reported one. */
  serving: { tech: string; channel: number; plmn: string } | null;
  /** Strongest cellular signal at each reading: lowest, average and highest of the session, in dBm. */
  cellularMin: number | null;
  cellularAvg: number | null;
  cellularMax: number | null;
  /** Readings with no cellular signal at all. */
  deadReadings: number;
  /** Wi-Fi: networks in the latest reading, different ones seen this session, and the band split of the latest reading. */
  wifiNow: number;
  wifiUnique: number;
  wifiBands: { ghz24: number; ghz5: number; ghz6: number };
  wifiStrongestDbm: number | null;
  /** Bluetooth: devices in the latest reading, different ones seen this session, and the most seen at once. */
  bluetoothNow: number;
  bluetoothUnique: number;
  bluetoothPeak: number;
  /** GPS satellites used in the latest fix and the best signal seen. */
  gpsUsed: number | null;
  gpsBestCn0: number | null;
}

export function emptyTotals(): SessionTotals {
  return {
    towers: 0,
    towersByTech: { lte: 0, nr: 0, wcdma: 0, gsm: 0 },
    serving: null,
    cellularMin: null,
    cellularAvg: null,
    cellularMax: null,
    deadReadings: 0,
    wifiNow: 0,
    wifiUnique: 0,
    wifiBands: { ghz24: 0, ghz5: 0, ghz6: 0 },
    wifiStrongestDbm: null,
    bluetoothNow: 0,
    bluetoothUnique: 0,
    bluetoothPeak: 0,
    gpsUsed: null,
    gpsBestCn0: null,
  };
}

/**
 * Counts what a session finds. Distinct networks and devices are counted from short session-only stand-ins supplied by
 * the scanner, never from addresses, and the sets live only in memory: they are dropped when the session ends and are
 * never saved or uploaded.
 */
export class SessionAccumulator {
  private towers = new Map<string, string>(); // key -> tech
  private wifi = new Set<number>();
  private bluetooth = new Set<number>();
  private cellularSum = 0;
  private cellularCount = 0;
  private t: SessionTotals = emptyTotals();

  add(scan: MappedScan): SessionTotals {
    // Work on a copy, so snapshots handed out earlier never change.
    const t: SessionTotals = { ...this.t, towersByTech: { ...this.t.towersByTech }, wifiBands: { ...this.t.wifiBands } };

    if (scan.cellular.available) {
      if (scan.cellular.cells.length === 0) {
        t.deadReadings += 1;
        t.serving = null;
      } else {
        const best = Math.max(...scan.cellular.cells.map((c) => c.dbm));
        this.cellularSum += best;
        this.cellularCount += 1;
        t.cellularMin = t.cellularMin === null ? best : Math.min(t.cellularMin, best);
        t.cellularMax = t.cellularMax === null ? best : Math.max(t.cellularMax, best);
        t.cellularAvg = this.cellularSum / this.cellularCount;
        for (const c of scan.cellular.cells) this.towers.set(`${c.plmn}:${c.tech}:${c.cellId}`, c.tech);
        const serving = scan.cellular.cells.find((c) => c.registered);
        t.serving = serving ? { tech: serving.tech, channel: serving.channel, plmn: serving.plmn } : t.serving;
      }
      t.towers = this.towers.size;
      const byTech = { lte: 0, nr: 0, wcdma: 0, gsm: 0 };
      for (const tech of this.towers.values()) if (tech in byTech) byTech[tech as keyof typeof byTech] += 1;
      t.towersByTech = byTech;
    }

    if (scan.wifi.available && typeof scan.wifi.count === 'number') {
      t.wifiNow = scan.wifi.count;
      for (const id of scan.wifi.ids ?? []) this.wifi.add(id);
      // Without ids (an older scanner) the best available figure is the largest count seen at once.
      t.wifiUnique = this.wifi.size > 0 ? this.wifi.size : Math.max(t.wifiUnique, scan.wifi.count);
      t.wifiBands = { ghz24: scan.wifi.band24 ?? 0, ghz5: scan.wifi.band5 ?? 0, ghz6: scan.wifi.band6 ?? 0 };
      if (typeof scan.wifi.strongestDbm === 'number') {
        t.wifiStrongestDbm = t.wifiStrongestDbm === null ? scan.wifi.strongestDbm : Math.max(t.wifiStrongestDbm, scan.wifi.strongestDbm);
      }
    }

    if (scan.bluetooth?.available && typeof scan.bluetooth.count === 'number') {
      t.bluetoothNow = scan.bluetooth.count;
      t.bluetoothPeak = Math.max(t.bluetoothPeak, scan.bluetooth.count);
      for (const id of scan.bluetooth.ids ?? []) this.bluetooth.add(id);
      t.bluetoothUnique = this.bluetooth.size > 0 ? this.bluetooth.size : Math.max(t.bluetoothUnique, scan.bluetooth.count);
    }

    if (typeof scan.gnss.used === 'number') t.gpsUsed = scan.gnss.used;
    if (typeof scan.gnss.avgCn0Used === 'number') t.gpsBestCn0 = t.gpsBestCn0 === null ? scan.gnss.avgCn0Used : Math.max(t.gpsBestCn0, scan.gnss.avgCn0Used);

    this.t = t;
    return t;
  }

  totals(): SessionTotals {
    return this.t;
  }

  /** Forgets the anonymous ids but keeps the numbers, so the finished session can still be summarised. */
  dropIds(): void {
    this.towers.clear();
    this.wifi.clear();
    this.bluetooth.clear();
  }

  /** Forgets everything, including the anonymous ids. Called at the start of each session. */
  reset(): void {
    this.towers.clear();
    this.wifi.clear();
    this.bluetooth.clear();
    this.cellularSum = 0;
    this.cellularCount = 0;
    this.t = emptyTotals();
  }
}

/** A copy of a scan without the anonymous ids, for anything that is kept (the latest reading shown on screen). */
export function withoutIds(scan: MappedScan): MappedScan {
  const wifi = { ...scan.wifi };
  delete wifi.ids;
  const bluetooth = scan.bluetooth ? { ...scan.bluetooth } : scan.bluetooth;
  if (bluetooth) delete bluetooth.ids;
  return { ...scan, wifi, bluetooth };
}
