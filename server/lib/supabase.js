'use strict';

/**
 * Talks to a Supabase project over its REST interface (PostgREST) with the service-role key. No dependencies.
 * The key bypasses row-level security, so it must stay on the server and never reach the app.
 */
function createSupabaseSink({ url, serviceKey, fetchImpl = fetch }) {
  if (!url || !serviceKey) throw new Error('Supabase needs SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  const base = `${url.replace(/\/+$/, '')}/rest/v1`;
  // Older JWT-style keys (eyJ...) are sent both ways. Newer sb_secret_ keys are not JWTs and go only in `apikey`.
  const headers = { apikey: serviceKey, 'content-type': 'application/json' };
  if (serviceKey.startsWith('eyJ')) headers.authorization = `Bearer ${serviceKey}`;

  async function call(method, path, body, extra = {}) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { ...headers, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
      throw new Error(`Supabase ${method} ${path.split('?')[0]} failed with HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    /** Saves an accepted report and the rewards it earned as pending. Safe to repeat. */
    async pushReport({ hash, node, type, receivedMs, body, summary, rewards }) {
      await call(
        'POST',
        '/reports?on_conflict=hash',
        [{ hash, node, type, received_at: new Date(receivedMs).toISOString(), body, summary }],
        { prefer: 'resolution=ignore-duplicates,return=minimal' }
      );
      if (rewards.length > 0) {
        await call(
          'POST',
          '/rewards?on_conflict=report_hash,kind,ref',
          rewards.map((r) => ({ node, report_hash: hash, kind: r.kind, ref: r.ref, amount_usdc: r.amountUsdc })),
          { prefer: 'resolution=ignore-duplicates,return=minimal' }
        );
      }
    },

    // ---- Review job (direct mode) ----

    /** Reports the app inserted that nobody has checked yet, oldest first. */
    async listNewReports(limit = 100) {
      return call('GET', `/reports?status=eq.new&type=neq.challenge-claim&order=received_at.asc&limit=${limit}&select=hash,node,type,received_at,body`);
    },

    /** The active challenges, in display order. */
    async listChallenges() {
      return call('GET', '/challenges?active=eq.true&order=sort.asc&select=id,title,blurb,period,metric,goal,reward,go_tab,active,sort');
    },

    /** Claims for challenge rewards that nobody has settled yet, oldest first. */
    async listNewClaims(limit = 50) {
      return call('GET', `/reports?status=eq.new&type=eq.challenge-claim&order=received_at.asc&limit=${limit}&select=hash,node,type,received_at,body`);
    },

    /** Whether this wallet already has a verified claim for the challenge in the period. */
    async findVerifiedClaim(node, challengeId, period) {
      const rows = await call('GET', `/reports?node=eq.${encodeURIComponent(node)}&type=eq.challenge-claim&status=eq.verified&body->report->>challengeId=eq.${encodeURIComponent(challengeId)}&body->report->>period=eq.${encodeURIComponent(period)}&select=hash&limit=1`);
      return Array.isArray(rows) && rows.length > 0;
    },

    /** The wallet's verified reports (not claims) in a time window, with the session length where the report has one. */
    async listVerifiedActivity(node, fromIso, toIso) {
      return call('GET', `/reports?node=eq.${encodeURIComponent(node)}&status=eq.verified&type=neq.challenge-claim&verified_at=gte.${encodeURIComponent(fromIso)}&verified_at=lt.${encodeURIComponent(toIso)}&select=type,seconds:body->report->checks->>durationSec&limit=1000`);
    },

    /** The wallet's submitted reports (not claims) that nobody has reviewed yet, received in a time window. */
    async listNewReportsFor(node, fromIso, toIso, limit = 200) {
      return call('GET', `/reports?node=eq.${encodeURIComponent(node)}&status=eq.new&type=neq.challenge-claim&received_at=gte.${encodeURIComponent(fromIso)}&received_at=lt.${encodeURIComponent(toIso)}&order=received_at.asc&limit=${limit}&select=hash,node,type,received_at,body`);
    },

    /** The wallet's 'new-cells' reward rows created in a time window. */
    async listNewCellRewards(node, fromIso, toIso) {
      return call('GET', `/rewards?node=eq.${encodeURIComponent(node)}&kind=eq.new-cells&status=neq.rejected&created_at=gte.${encodeURIComponent(fromIso)}&created_at=lt.${encodeURIComponent(toIso)}&select=amount_usdc&limit=1000`);
    },

    /** Records the review result on a report. */
    async finishReport(hash, status, reasons) {
      await call('PATCH', `/reports?hash=eq.${encodeURIComponent(hash)}`, { status, reasons: reasons && reasons.length ? reasons : null, verified_at: new Date().toISOString() }, { prefer: 'return=minimal' });
    },

    /** One report with its body, whatever its state. Null if there is none. */
    async getReport(hash) {
      const rows = await call('GET', `/reports?hash=eq.${encodeURIComponent(hash)}&select=hash,node,type,received_at,body,status,onchain_tx,onchain_record,onchain_error,onchain_amount`);
      return rows && rows[0] ? rows[0] : null;
    },

    /** Adds rewards for a report. A person approving a report creates them already 'approved', ready for the weekly payout. Safe to repeat. */
    async insertRewards(hash, node, rows, status = 'pending') {
      if (rows.length === 0) return;
      const approvedAt = status === 'approved' ? new Date().toISOString() : null;
      await call(
        'POST',
        '/rewards?on_conflict=report_hash,kind,ref',
        rows.map((r) => ({ node, report_hash: hash, kind: r.kind, ref: r.ref, amount_usdc: r.amountUsdc, status, ...(approvedAt ? { approved_at: approvedAt } : {}) })),
        { prefer: 'resolution=ignore-duplicates,return=minimal' }
      );
    },

    /** Records the on-chain payout state of a report. Only the four on-chain columns can be written. */
    async setOnchain(hash, patch) {
      const allowed = ['onchain_tx', 'onchain_record', 'onchain_error', 'onchain_amount'];
      for (const k of Object.keys(patch)) if (!allowed.includes(k)) throw new Error(`${k} is not an on-chain column`);
      await call('PATCH', `/reports?hash=eq.${encodeURIComponent(hash)}`, patch, { prefer: 'return=minimal' });
    },

    /** Verified reports that carry an AZMTest payout, newest first, whether paid on-chain or not yet. */
    async listPayouts(limit = 30) {
      return call('GET', `/reports?status=eq.verified&onchain_amount=gt.0&order=verified_at.desc&limit=${limit}&select=hash,node,type,status,verified_at,onchain_tx,onchain_record,onchain_error,onchain_amount`);
    },

    async listChests() {
      return call('GET', '/chests?status=eq.open&select=*&order=created_at.asc&limit=1000');
    },

    async updateChest(id, patch) {
      await call('PATCH', `/chests?id=eq.${encodeURIComponent(id)}`, patch, { prefer: 'return=minimal' });
    },

    async createChest(row) {
      const out = await call('POST', '/chests', [row], { prefer: 'return=representation' });
      return out[0];
    },

    async listDeletionRequests(limit = 100) {
      return call('GET', `/deletion_requests?status=eq.new&order=created_at.asc&limit=${limit}&select=id,node,issued_ms,signature`);
    },

    async finishDeletion(id, status, note) {
      await call('PATCH', `/deletion_requests?id=eq.${encodeURIComponent(id)}`, { status, note: note || null }, { prefer: 'return=minimal' });
    },

    /** Replaces the stored readings for a wallet with a deletion marker. */
    async eraseNode(node) {
      await call('PATCH', `/reports?node=eq.${encodeURIComponent(node)}`, { body: { deleted: true }, summary: {} }, { prefer: 'return=minimal' });
      // The encrypted progress backups of that wallet go too (the table exists once schema_backup.sql has been run).
      try {
        await call('DELETE', `/backups?node=eq.${encodeURIComponent(node)}`, undefined, { prefer: 'return=minimal' });
      } catch (e) {
        if (!/HTTP 404/.test(String(e && e.message))) throw e;
      }
    },

    /** Rewards you approved in the dashboard that have not been paid. */
    async listApproved(limit = 1000) {
      return call('GET', `/rewards?status=eq.approved&paid_at=is.null&select=id,node,amount_usdc&order=created_at.asc&limit=${limit}`);
    },

    /** Marks rewards as paid. Only rows still in the approved state can be marked, so nothing is paid twice. */
    async markPaid(ids, tx) {
      if (ids.length === 0) return;
      const list = ids.map(encodeURIComponent).join(',');
      await call('PATCH', `/rewards?id=in.(${list})&status=eq.approved`, { status: 'paid', paid_at: new Date().toISOString(), tx }, { prefer: 'return=minimal' });
    },
  };
}

module.exports = { createSupabaseSink };
