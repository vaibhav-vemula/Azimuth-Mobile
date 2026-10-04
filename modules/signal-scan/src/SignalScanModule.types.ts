export interface CellReading {
  tech: 'lte' | 'nr' | 'wcdma' | 'gsm';
  registered: boolean;
  /** Received signal power in dBm. Not every phone reports every technology the same way. */
  dbm: number;
  /** Android's own 0 to 4 bar level. */
  level: number;
  /** Tower/cell identity. Infrastructure, not a person. */
  cellId: string;
  /** Radio channel number (EARFCN / NR-ARFCN / UARFCN / ARFCN). */
  channel: number;
  plmn: string;
}

export interface CellularSnapshot {
  available: boolean;
  reason?: string;
  operator?: string;
  cells: CellReading[];
}

/** Counts and levels only. Network names and hardware addresses are never returned. */
export interface WifiSnapshot {
  available: boolean;
  reason?: string;
  count?: number;
  strongestDbm?: number | null;
  medianDbm?: number | null;
  band24?: number;
  band5?: number;
  band6?: number;
  /** Age of the newest cached result; Android throttles fresh scans. */
  ageMs?: number | null;
  scanRequested?: boolean;
}

export interface BluetoothSnapshot {
  available: boolean;
  reason?: string;
  count?: number;
  strongestDbm?: number | null;
  medianDbm?: number | null;
  /** A tag whose advertised name starts with the requested prefix was heard. */
  beaconSeen?: boolean;
  beaconRssi?: number | null;
}

export interface GnssSnapshot {
  available?: boolean;
  reason?: string;
  satellites?: number;
  used?: number;
  avgCn0Used?: number | null;
  avgCn0All?: number | null;
  atMs?: number;
}

export interface ScanResult {
  atMs: number;
  cellular: CellularSnapshot;
  wifi: WifiSnapshot;
  bluetooth: BluetoothSnapshot | null;
  gnss: GnssSnapshot;
}

export interface ScanCapabilities {
  telephony: boolean;
  wifi: boolean;
  bluetoothLe: boolean;
  sdk: number;
  model: string;
}

export interface SignalScanNativeModule {
  getCapabilities(): Promise<ScanCapabilities>;
  startMapping(): Promise<void>;
  stopMapping(): Promise<void>;
  scan(includeBluetooth: boolean, beaconPrefix: string | null): Promise<ScanResult>;
}
