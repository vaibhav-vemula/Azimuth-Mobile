export type RtlSdrStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'streaming'
  | 'error';

export interface SignalDataEvent {
  /** 64 normalized (0..1) FFT power bins, low frequency to high. */
  bins: number[];
  /** RMS level of the raw samples as a fraction of the converter's full scale (0..1). */
  rms: number;
  /** Fraction of raw samples sitting on the converter's rails; above ~0.1% the front end is overloaded. */
  clip: number;
}

export interface StatusChangeEvent {
  status: RtlSdrStatus;
  deviceName: string | null;
  /** Currently tuned center frequency in Hz. */
  frequency: number;
  /** Current sample rate in Hz; the spectrum spans this much bandwidth. */
  sampleRate: number;
}

export interface RecordingStatusEvent {
  active: boolean;
  name: string | null;
  /** Bytes written to baseband.cs8 so far. */
  bytes: number;
  /** Complex samples written (at 288 kS/s). */
  samples: number;
  /** USB blocks lost to overflow since the recording began; 0 means a gap-free capture. */
  droppedBlocks: number;
  elapsedMs: number;
  directory?: string | null;
  error: string | null;
}

export interface RecordingStart {
  directory: string;
  dataPath: string;
  metadataPath: string;
}

export interface RecordingInfo {
  name: string;
  directory: string;
  dataBytes: number;
  /** Contents of baseband.sigmf-meta, if present. */
  metadata: string | null;
  modifiedMs: number;
  imagePaths: string[];
  active: boolean;
}

export type SignalDataListener = (event: SignalDataEvent) => void;
export type StatusChangeListener = (event: StatusChangeEvent) => void;
export type RecordingStatusListener = (event: RecordingStatusEvent) => void;

export type RtlSdrModuleEvents = {
  onSignalData: SignalDataListener;
  onStatusChange: StatusChangeListener;
  onRecordingStatus: RecordingStatusListener;
};

export interface RtlSdrSubscription {
  remove(): void;
}

export interface RtlSdrNativeModule {
  connect(): Promise<StatusChangeEvent>;
  tune(frequencyHz: number): Promise<void>;
  startStream(): Promise<void>;
  stopStream(): Promise<void>;
  disconnect(): Promise<void>;
  /** Plays demodulated mono wideband-FM audio (75 us de-emphasis) while a 2.4 MS/s stream is running. */
  setAudioEnabled(enabled: boolean): Promise<void>;
  /** Output volume, 0..1. */
  setVolume(volume: number): Promise<void>;
  /** 2_400_000 (FM/general) or 2_304_000 (satellite recording). Stop the stream first. */
  setSampleRate(rateHz: number): Promise<void>;
  /** null selects automatic gain; otherwise returns the nearest supported gain in dB. */
  setGain(gainDb: number | null): Promise<number | null>;
  getGains(): Promise<number[]>;
  setBiasTee(enabled: boolean): Promise<void>;
  /** Begins writing a decimated .cs8 recording. Requires a running 2.304 MS/s stream. */
  /** `maxDurationMs` is a hard native-side limit so a recording can never outlive its pass. */
  startRecording(name: string, label: string, maxDurationMs: number): Promise<RecordingStart>;
  stopRecording(): Promise<RecordingStatusEvent>;
  writeRecordingMetadata(name: string, json: string): Promise<void>;
  listRecordings(): Promise<RecordingInfo[]>;
  deleteRecording(name: string): Promise<void>;
  /** Copies the recording to Downloads/Azimuth/<name>; resolves with that relative path. */
  exportRecording(name: string): Promise<string>;
  getFreeStorageBytes(): Promise<number>;
  addListener<EventName extends keyof RtlSdrModuleEvents>(
    eventName: EventName,
    listener: RtlSdrModuleEvents[EventName]
  ): RtlSdrSubscription;
}
