import crypto from 'node:crypto';
import bs58 from 'bs58';
import { buildReport, reportHash, signingMessage } from '../report';
import { canonicalize } from '../canonical';
import { emptyBucket } from '../../mapping/aggregate';
// The verifier is deliberately independent of the app code.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const verifier = require('../../../tools/verify-report.cjs') as {
  verifyEnvelope: (e: unknown) => { valid: boolean; problems: string[] };
  canonicalize: (v: unknown) => string;
};

function makeSigned(tamper?: (r: ReturnType<typeof buildReport>) => void) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const node = bs58.encode(raw);
  const bucket = emptyBucket('h120:1:2', 1_700_000_000_000);
  bucket.samples = 3;
  const report = buildReport({
    type: 'mapping-session',
    node,
    device: { model: 'Seeker', app: '1.0.0' },
    buckets: [bucket],
    checks: { samples: 3, mockedFixes: 0, poorAccuracyFixes: 0, maxSpeedMps: 1.4, durationSec: 60 },
  });
  const signature = crypto.sign(null, Buffer.from(signingMessage(report)), privateKey).toString('base64');
  const envelope = { report, signature, hash: reportHash(report) };
  if (tamper) tamper(envelope.report);
  return envelope;
}

describe('canonical JSON', () => {
  it('is identical between the app and the verifier', () => {
    const value = { b: [1, { z: 1, a: 'x' }], a: null, c: undefined, d: 1.5 };
    expect(canonicalize(value)).toBe(verifier.canonicalize(value));
    expect(canonicalize(value)).toBe('{"a":null,"b":[1,{"a":"x","z":1}],"d":1.5}');
  });
});

describe('independent verifier', () => {
  it('accepts a correctly signed report', () => {
    const result = verifier.verifyEnvelope(makeSigned());
    expect(result.problems).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects a report changed after signing', () => {
    const result = verifier.verifyEnvelope(makeSigned((r) => { r.checks.samples = 999; }));
    expect(result.valid).toBe(false);
    expect(result.problems.join(' ')).toMatch(/hash|signature/);
  });

  it('rejects a signature from a different key', () => {
    const envelope = makeSigned();
    const other = makeSigned();
    const forged = { ...envelope, signature: other.signature };
    expect(verifier.verifyEnvelope(forged).valid).toBe(false);
  });

  it('rejects reports that carry network identifiers', () => {
    const envelope = makeSigned();
    (envelope.report as unknown as Record<string, unknown>).ssid = 'CoffeeShop';
    expect(verifier.verifyEnvelope(envelope).valid).toBe(false);
  });

  it('rejects an empty report', () => {
    const envelope = makeSigned((r) => { r.buckets = []; });
    expect(verifier.verifyEnvelope(envelope).valid).toBe(false);
  });
});
