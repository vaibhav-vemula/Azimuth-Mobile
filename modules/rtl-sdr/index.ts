import RtlSdrModule from './src/RtlSdrModule';
import type {
  RtlSdrSubscription,
  SignalDataListener,
  StatusChangeEvent,
  StatusChangeListener,
} from './src/RtlSdrModule.types';

export * from './src/RtlSdrModule.types';

export const MIN_FREQUENCY_HZ = 500_000;
export const MAX_FREQUENCY_HZ = 1_766_000_000;
export const BIN_COUNT = 64;

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

export function addSignalListener(listener: SignalDataListener): RtlSdrSubscription {
  return RtlSdrModule.addListener('onSignalData', listener);
}

export function addStatusListener(listener: StatusChangeListener): RtlSdrSubscription {
  return RtlSdrModule.addListener('onStatusChange', listener);
}

export default RtlSdrModule;
