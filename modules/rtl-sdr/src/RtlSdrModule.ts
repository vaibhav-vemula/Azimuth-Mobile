import { requireNativeModule } from 'expo';

import type { RtlSdrNativeModule } from './RtlSdrModule.types';

export default requireNativeModule<RtlSdrNativeModule>('rtl-sdr');
