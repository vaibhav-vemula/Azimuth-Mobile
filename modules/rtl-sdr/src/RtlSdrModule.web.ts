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
  addListener<EventName extends keyof RtlSdrModuleEvents>(
    eventName: EventName,
    _listener: RtlSdrModuleEvents[EventName]
  ): RtlSdrSubscription {
    console.warn(`[rtl-sdr] addListener('${eventName}') on web: ${UNSUPPORTED_MESSAGE}`);
    return { remove() {} };
  },
};

export default RtlSdrWebModule;
