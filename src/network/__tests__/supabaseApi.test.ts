import { chestFromRow, createSupabaseApi } from '../supabaseApi';
import type { SignedReport } from '../../reports/report';

function fakeFetch(responses: { status: number; body?: unknown }[]) {
  const calls: { url: string; init: RequestInit & { headers: Record<string, string> } }[] = [];
  const impl = (async (url: string, init: RequestInit & { headers: Record<string, string> }) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 200, body: [] };
    return { status: r.status, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const signed = {
  hash: 'a'.repeat(64),
  signature: 'sig',
  report: { version: 1, type: 'mapping-session', node: 'NodeAddr1111111111111111111111111111111111', device: { model: 'x', app: '1' }, firstBucketMs: 0, buckets: [], checks: {} },
} as unknown as SignedReport;

const api = (f: ReturnType<typeof fakeFetch>, key = 'sb_publishable_abc') => createSupabaseApi({ url: 'https://x.supabase.co', key, fetchImpl: f.impl });

describe('Supabase direct API', () => {
  it('sends only the public key, and only in the apikey header for new-style keys', async () => {
    const f = fakeFetch([{ status: 201 }]);
    await api(f).submitReport(signed);
    expect(f.calls[0].init.headers.apikey).toBe('sb_publishable_abc');
    expect(f.calls[0].init.headers.authorization).toBeUndefined();
  });

  it('also sends the bearer header for older JWT-style keys', async () => {
    const f = fakeFetch([{ status: 201 }]);
    await api(f, 'eyJabc.def.ghi').submitReport(signed);
    expect(f.calls[0].init.headers.authorization).toBe('Bearer eyJabc.def.ghi');
  });

  it('files a report with only the columns the public key may set', async () => {
    const f = fakeFetch([{ status: 201 }]);
    const out = await api(f).submitReport(signed);
    expect(out).toEqual({ accepted: true, pending: true, hash: signed.hash, reasons: [] });
    expect(f.calls[0].url).toBe('https://x.supabase.co/rest/v1/reports');
    const body = JSON.parse(String(f.calls[0].init.body));
    expect(Object.keys(body).sort()).toEqual(['body', 'hash', 'node', 'type']);
    expect(body.body.signature).toBe('sig');
  });

  it('turns duplicates, throttling and bad shape into clear answers', async () => {
    expect((await api(fakeFetch([{ status: 409 }])).submitReport(signed)).reasons[0]).toMatch(/already submitted/);
    const busy = await api(fakeFetch([{ status: 400, body: { message: 'too many reports from this wallet this hour' } }])).submitReport(signed);
    expect(busy.accepted).toBe(false);
    expect(busy.reasons[0]).toMatch(/too many/);
    const shape = await api(fakeFetch([{ status: 400, body: { message: 'new row violates check constraint "reports_shape"' } }])).submitReport(signed);
    expect(shape.reasons[0]).toMatch(/malformed/);
    await expect(api(fakeFetch([{ status: 500, body: { message: 'boom' } }])).submitReport(signed)).rejects.toThrow('boom');
  });

  it('lists chests with remaining fills and expiry', async () => {
    const row = { id: 'c1', title: 'Wi-Fi', kind: 'wifi-quality', cell_id: 'h120:1:1', reward_usdc: '0.500000', max_fills: 5, fills: 2, expires_at: '2026-10-09T00:00:00Z', requester: 'Cafe', requires: 'phone', spec: null };
    const chests = await api(fakeFetch([{ status: 200, body: [row] }])).fetchChests();
    expect(chests).toEqual([{ id: 'c1', title: 'Wi-Fi', kind: 'wifi-quality', cellId: 'h120:1:1', rewardUsdc: 0.5, remaining: 3, expiresMs: Date.parse('2026-10-09T00:00:00Z'), requester: 'Cafe', requires: 'phone', spec: {} }]);
    expect(chestFromRow({ ...row, fills: 9 } as unknown as Parameters<typeof chestFromRow>[0]).remaining).toBe(0);
  });

  it('reads earnings through the summary function', async () => {
    const f = fakeFetch([{ status: 200, body: { pendingUsdc: 0.25, approvedUsdc: 1, paidUsdc: 2, entries: [{ kind: 'chest', ref: 'c1', amount_usdc: 1, status: 'approved', created_ms: 1 }] } }]);
    const s = await api(f).fetchNodeSummary('Addr');
    expect(f.calls[0].url).toBe('https://x.supabase.co/rest/v1/rpc/node_summary');
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ p_node: 'Addr' });
    expect([s.totalUsdc, s.pendingUsdc, s.approvedUsdc, s.paidUsdc, s.entries.length]).toEqual([3.25, 0.25, 1, 2, 1]);
  });

  it('files deletion requests as signed requests', async () => {
    const f = fakeFetch([{ status: 201 }]);
    expect(await api(f).deleteMyData('Addr', 123, 'sigsig')).toEqual({ ok: true, queued: true });
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ node: 'Addr', issued_ms: 123, signature: 'sigsig' });
    const limited = await api(fakeFetch([{ status: 400, body: { message: 'too many requests' } }])).deleteMyData('Addr', 1, 's');
    expect(limited.ok).toBe(false);
  });

  it('reports network failures plainly', async () => {
    const impl = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await expect(createSupabaseApi({ url: 'https://x.supabase.co', key: 'k', fetchImpl: impl }).fetchChests()).rejects.toThrow('Could not reach the server');
  });
  it('maps the AZMTest total and the verified list from node_summary, and tolerates their absence', async () => {
    const f = fakeFetch([
      { status: 200, body: { pendingUsdc: 0, approvedUsdc: 0, paidUsdc: 0, entries: [], azmTotal: 14, verified: [{ hash: 'h', type: 'mapping-session', amount: 14, record: 'REC', verified_ms: 5 }] } },
      { status: 200, body: { pendingUsdc: 0, approvedUsdc: 0, paidUsdc: 0, entries: [] } },
    ]);
    const a = api(f);
    const full = await a.fetchNodeSummary('Addr');
    expect(full.azmTotal).toBe(14);
    expect(full.verified).toEqual([{ hash: 'h', type: 'mapping-session', amount: 14, record: 'REC', verified_ms: 5 }]);
    const bare = await a.fetchNodeSummary('Addr');
    expect(bare.azmTotal).toBe(0);
    expect(bare.verified).toEqual([]);
  });

  it('submits a challenge claim as a report row of type challenge-claim', async () => {
    const f = fakeFetch([{ status: 201 }, { status: 409 }]);
    const claim = { report: { version: 1, type: 'challenge-claim', node: 'N', challengeId: 'scan-30', period: '2026-10-10', claimedMs: 1 }, signature: 's', hash: 'a'.repeat(64) };
    const out = await api(f).submitClaim(claim as never);
    expect(out).toMatchObject({ accepted: true, pending: true });
    const sent = JSON.parse(f.calls[0].init.body as string);
    expect(sent).toMatchObject({ hash: 'a'.repeat(64), node: 'N', type: 'challenge-claim' });
    expect(await api(f).submitClaim(claim as never)).toMatchObject({ accepted: false });
  });

  it('fetches the challenge list from the server and drops invalid rows', async () => {
    const f = fakeFetch([{ status: 200, body: [
      { id: 'scan-30', title: 'Scan', blurb: '', period: 'daily', metric: 'mapping_minutes', goal: 30, reward: 5, go_tab: 'Map' },
      { id: 'bad', title: 'Bad', blurb: '', period: 'daily', metric: 'mapping_minutes', goal: 30, reward: 0, go_tab: 'Map' },
    ] }, { status: 500, body: { message: 'boom' } }]);
    const a = api(f);
    expect((await a.fetchChallenges()).map((c) => c.id)).toEqual(['scan-30']);
    expect(f.calls[0].url).toMatch(/\/challenges\?active=eq\.true&order=sort\.asc/);
    await expect(a.fetchChallenges()).rejects.toThrow();
  });

  it('maps claims from node_summary and tolerates their absence', async () => {
    const f = fakeFetch([
      { status: 200, body: { pendingUsdc: 0, approvedUsdc: 0, paidUsdc: 0, entries: [], claims: [{ challengeId: 'scan-30', period: '2026-10-10', status: 'rejected', reasons: ['23 of 30'] }] } },
      { status: 200, body: { pendingUsdc: 0, approvedUsdc: 0, paidUsdc: 0, entries: [] } },
    ]);
    const a = api(f);
    expect((await a.fetchNodeSummary('Addr')).claims).toEqual([{ challengeId: 'scan-30', period: '2026-10-10', status: 'rejected', reasons: ['23 of 30'] }]);
    expect((await a.fetchNodeSummary('Addr')).claims).toEqual([]);
  });
});
