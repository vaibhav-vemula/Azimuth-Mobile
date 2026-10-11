import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { canonicalize } from '../reports/canonical';
import { SIGNING_PREFIX } from '../reports/report';
import { signText } from '../wallet/signReport';
import { submitClaim } from '../network/api';
import type { SubmitResult } from '../network/api';

export interface ChallengeClaim {
  version: 1;
  type: 'challenge-claim';
  node: string;
  challengeId: string;
  period: string;
  claimedMs: number;
}

export function buildClaim(node: string, challengeId: string, period: string, claimedMs: number): ChallengeClaim {
  return { version: 1, type: 'challenge-claim', node, challengeId, period, claimedMs };
}

export const claimHash = (c: ChallengeClaim): string => bytesToHex(sha256(utf8ToBytes(canonicalize(c))));
export const claimSigningText = (c: ChallengeClaim): string => SIGNING_PREFIX + canonicalize(c);

/** One wallet prompt: signs the claim and sends it. The server pays it after re-checking the numbers. */
export async function signAndSubmitClaim(claim: ChallengeClaim, walletBase64: string): Promise<SubmitResult> {
  const signature = await signText(claimSigningText(claim), walletBase64);
  return submitClaim({ report: claim, signature, hash: claimHash(claim) });
}
