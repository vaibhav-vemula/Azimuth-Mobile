// Solana libraries expect these Node/web globals; React Native has neither.
import 'react-native-get-random-values';
import { Buffer } from 'buffer';

if (typeof globalThis.Buffer === 'undefined') {
  (globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;
}
