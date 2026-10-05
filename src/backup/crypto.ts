import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/** The exact text the wallet signs to unlock the backup. It names the wallet, so each wallet gets its own key. */
export function unlockMessage(address: string): string {
  return `Azimuth backup key v1\nWallet: ${address}\nSigning this lets this app encrypt and restore your map progress. It costs nothing and sends nothing on-chain.`;
}

export interface BackupKeys {
  /** The 32-byte encryption key, as hex (kept on this phone, never uploaded). */
  key: string;
  /** A public label for this wallet's backups. It cannot be guessed without the signature, so strangers cannot overwrite or evict a real backup. */
  tag: string;
}

/**
 * Keys from the wallet's signature of the unlock message. Ed25519 signatures are deterministic, so the same wallet always
 * gives the same keys, on this phone or any other, without ever exporting a secret.
 */
export function deriveKeys(signature: Uint8Array): BackupKeys {
  const derive = (info: string, length: number) => hkdf(sha256, signature, utf8ToBytes('azimuth-backup-v1'), utf8ToBytes(info), length);
  return { key: bytesToHex(derive('encryption', 32)), tag: bytesToHex(derive('lookup', 16)) };
}

const hexToBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const fromBase64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));

/** Encrypts and authenticates `plain`. The result is base64 of a fresh random nonce followed by the ciphertext. */
export function seal(plain: Uint8Array, keyHex: string): string {
  const nonce = randomBytes(24);
  const cipher = xchacha20poly1305(hexToBytes(keyHex), nonce).encrypt(plain);
  const out = new Uint8Array(nonce.length + cipher.length);
  out.set(nonce);
  out.set(cipher, nonce.length);
  return toBase64(out);
}

/** Reverses seal. Throws if the data was changed or the key is wrong. */
export function open(sealed: string, keyHex: string): Uint8Array {
  const bytes = fromBase64(sealed);
  if (bytes.length < 24 + 16) throw new Error('This backup is damaged.');
  try {
    return xchacha20poly1305(hexToBytes(keyHex), bytes.slice(0, 24)).decrypt(bytes.slice(24));
  } catch {
    throw new Error('This backup cannot be opened with this wallet.');
  }
}
