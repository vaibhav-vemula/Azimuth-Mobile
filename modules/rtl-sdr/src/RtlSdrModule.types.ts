export type RtlSdrStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'streaming'
  | 'error';

export interface SignalDataEvent {
  /** 64 normalized (0..1) FFT power bins, low frequency to high. */
  bins: number[];
}

export interface StatusChangeEvent {
  status: RtlSdrStatus;
  deviceName: string | null;
  /** Currently tuned center frequency in Hz. */
  frequency: number;
}

export type SignalDataListener = (event: SignalDataEvent) => void;
export type StatusChangeListener = (event: StatusChangeEvent) => void;

export type RtlSdrModuleEvents = {
  onSignalData: SignalDataListener;
  onStatusChange: StatusChangeListener;
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
  /** Plays demodulated mono wideband-FM audio (75 us de-emphasis) while a stream is running. */
  setAudioEnabled(enabled: boolean): Promise<void>;
  /** Output volume, 0..1. */
  setVolume(volume: number): Promise<void>;
  addListener<EventName extends keyof RtlSdrModuleEvents>(
    eventName: EventName,
    listener: RtlSdrModuleEvents[EventName]
  ): RtlSdrSubscription;
}
