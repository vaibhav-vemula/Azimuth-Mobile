import { buildClaim, claimHash, claimSigningText } from '../claim';
import { SIGNING_PREFIX } from '../../reports/report';
import { canonicalize } from '../../reports/canonical';

describe('challenge claim', () => {
  const claim = buildClaim('Node1111111111111111111111111111111111111', 'scan-30', '2026-10-10', 1_000);

  it('has the exact shape the server verifies', () => {
    expect(claim).toEqual({ version: 1, type: 'challenge-claim', node: 'Node1111111111111111111111111111111111111', challengeId: 'scan-30', period: '2026-10-10', claimedMs: 1_000 });
  });
  it('signs the prefixed canonical text and hashes the canonical form', () => {
    expect(claimSigningText(claim)).toBe(SIGNING_PREFIX + canonicalize(claim));
    expect(claimHash(claim)).toMatch(/^[0-9a-f]{64}$/);
    expect(claimHash(claim)).toBe(claimHash({ ...claim }));
    expect(claimHash(claim)).not.toBe(claimHash({ ...claim, period: '2026-10-11' }));
  });
});
