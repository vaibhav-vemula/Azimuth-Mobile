import type {
  RtlSdrModuleEvents,
  RtlSdrNativeModule,
  RtlSdrSubscription,
} from './RtlSdrModule.types';

const UNSUPPORTED_MESSAGE =
  'rtl-sdr is not supported on web. Run Azimuth on an Android device with a USB-OTG RTL-SDR receiver.';

function unsupported(method: string): never {
  console.warn(`[rtl-sdr] ${method}() called on web: ${UNSUPPORTED_MESSAGE}`);
  throw new Error(UNSUPPORTED_MESSAGE);
}

const RtlSdrWebModule: RtlSdrNativeModule = {
  async connect() {
    return unsupported('connect');
  },
  async tune(_frequencyHz: number) {
    return unsupported('tune');
  },
  async startStream() {
    return unsupported('startStream');
  },
  async stopStream() {
    return unsupported('stopStream');
  },
  async disconnect() {
    return unsupported('disconnect');
  },
  async setAudioEnabled(_enabled: boolean) {
    return unsupported('setAudioEnabled');
  },
  async setVolume(_volume: number) {
    return unsupported('setVolume');
  },
  async setSampleRate(_rateHz: number) {
    return unsupported('setSampleRate');
  },
  async setGain(_gainDb: number | null) {
    return unsupported('setGain');
  },
  async getGains() {
    return unsupported('getGains');
  },
  async setBiasTee(_enabled: boolean) {
    return unsupported('setBiasTee');
  },
  async startRecording(_name: string, _label: string, _maxDurationMs: number, _fullBand: boolean) {
    return unsupported('startRecording');
  },
  async stopRecording() {
    return unsupported('stopRecording');
  },
  async writeRecordingMetadata(_name: string, _json: string) {
    return unsupported('writeRecordingMetadata');
  },
  async listRecordings() {
    return unsupported('listRecordings');
  },
  async deleteRecording(_name: string) {
    return unsupported('deleteRecording');
  },
  async exportRecording(_name: string) {
    return unsupported('exportRecording');
  },
  async getFreeStorageBytes() {
    return unsupported('getFreeStorageBytes');
  },
  addListener<EventName extends keyof RtlSdrModuleEvents>(
    eventName: EventName,
    _listener: RtlSdrModuleEvents[EventName]
  ): RtlSdrSubscription {
    console.warn(`[rtl-sdr] addListener('${eventName}') on web: ${UNSUPPORTED_MESSAGE}`);
    return { remove() {} };
  },
};

export default RtlSdrWebModule;
