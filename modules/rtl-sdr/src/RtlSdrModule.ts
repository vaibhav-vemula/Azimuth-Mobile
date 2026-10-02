import { requireNativeModule } from 'expo-modules-core';

import type { RtlSdrNativeModule } from './RtlSdrModule.types';

export default requireNativeModule<RtlSdrNativeModule>('rtl-sdr');
