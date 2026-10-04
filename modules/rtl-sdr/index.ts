import RtlSdrModule from './src/RtlSdrModule';
import type {
  RecordingInfo,
  RecordingStart,
  RecordingStatusEvent,
  RecordingStatusListener,
  RtlSdrSubscription,
  SignalDataListener,
  StatusChangeEvent,
  StatusChangeListener,
} from './src/RtlSdrModule.types';

export * from './src/RtlSdrModule.types';

export const MIN_FREQUENCY_HZ = 500_000;
export const MAX_FREQUENCY_HZ = 1_766_000_000;
export const BIN_COUNT = 64;

/** Sample rate used for FM listening and general spectrum viewing. */
export const FM_SAMPLE_RATE_HZ = 2_400_000;
/** Sample rate used while recording satellite passes. */
export const SATELLITE_SAMPLE_RATE_HZ = 2_304_000;
/** Compact recordings are decimated by 8; full-band recordings keep the whole 2.304 MS/s. */
export const COMPACT_RECORDING_SAMPLE_RATE_HZ = SATELLITE_SAMPLE_RATE_HZ / 8;

export function connect(): Promise<StatusChangeEvent> {
  return RtlSdrModule.connect();
}

export function tune(frequencyHz: number): Promise<void> {
  return RtlSdrModule.tune(frequencyHz);
}

export function startStream(): Promise<void> {
  return RtlSdrModule.startStream();
}

export function stopStream(): Promise<void> {
  return RtlSdrModule.stopStream();
}

export function disconnect(): Promise<void> {
  return RtlSdrModule.disconnect();
}

export function setAudioEnabled(enabled: boolean): Promise<void> {
  return RtlSdrModule.setAudioEnabled(enabled);
}

export function setVolume(volume: number): Promise<void> {
  return RtlSdrModule.setVolume(volume);
}

export function setSampleRate(rateHz: number): Promise<void> {
  return RtlSdrModule.setSampleRate(rateHz);
}

export function setGain(gainDb: number | null): Promise<number | null> {
  return RtlSdrModule.setGain(gainDb);
}

export function getGains(): Promise<number[]> {
  return RtlSdrModule.getGains();
}

export function setBiasTee(enabled: boolean): Promise<void> {
  return RtlSdrModule.setBiasTee(enabled);
}

export function startRecording(name: string, label: string, maxDurationMs: number, fullBand: boolean): Promise<RecordingStart> {
  return RtlSdrModule.startRecording(name, label, maxDurationMs, fullBand);
}

export function stopRecording(): Promise<RecordingStatusEvent> {
  return RtlSdrModule.stopRecording();
}

export function writeRecordingMetadata(name: string, json: string): Promise<void> {
  return RtlSdrModule.writeRecordingMetadata(name, json);
}

export function listRecordings(): Promise<RecordingInfo[]> {
  return RtlSdrModule.listRecordings();
}

export function deleteRecording(name: string): Promise<void> {
  return RtlSdrModule.deleteRecording(name);
}

export function exportRecording(name: string): Promise<string> {
  return RtlSdrModule.exportRecording(name);
}

export function getFreeStorageBytes(): Promise<number> {
  return RtlSdrModule.getFreeStorageBytes();
}

export function addSignalListener(listener: SignalDataListener): RtlSdrSubscription {
  return RtlSdrModule.addListener('onSignalData', listener);
}

export function addStatusListener(listener: StatusChangeListener): RtlSdrSubscription {
  return RtlSdrModule.addListener('onStatusChange', listener);
}

export function addRecordingListener(listener: RecordingStatusListener): RtlSdrSubscription {
  return RtlSdrModule.addListener('onRecordingStatus', listener);
}

export default RtlSdrModule;
