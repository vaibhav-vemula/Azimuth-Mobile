import { requireNativeModule } from 'expo';

import type { SignalScanNativeModule } from './SignalScanModule.types';

export default requireNativeModule<SignalScanNativeModule>('signal-scan');
