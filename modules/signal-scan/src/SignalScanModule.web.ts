import type { SignalScanNativeModule } from './SignalScanModule.types';

const unsupported = () => Promise.reject(new Error('Signal scanning is only available on Android.'));

const stub: SignalScanNativeModule = {
  getCapabilities: unsupported,
  startMapping: unsupported,
  stopMapping: unsupported,
  scan: unsupported,
};

export default stub;
