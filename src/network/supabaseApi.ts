import type { SignedReport } from '../reports/report';
import type { Chest, DeleteResult, NodeSummary, SubmitResult } from './api';

const TIMEOUT_MS = 15_000;

interface Row {
  id: string;
  title: string;
  kind: Chest['kind'];
  cell_id: string;
  reward_usdc: number | string;
  max_fills: number;
  fills: number;
  expires_at: string;
  requester: string;
  requires: Chest['requires'];
  spec: Chest['spec'] | null;
}

export function chestFromRow(row: Row): Chest {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    cellId: row.cell_id,
    rewardUsdc: Number(row.reward_usdc),
    remaining: Math.max(0, row.max_fills - row.fills),
    expiresMs: Date.parse(row.expires_at),
    requester: row.requester,
    requires: row.requires,
    spec: row.spec ?? {},
  };
}

/**
 * Talks to Supabase with the PUBLISHABLE key. That key is public by design: what it may do is decided by the
 * database rules in server/supabase/schema_direct.sql (insert reports, read open chests, ask for deletion,
 * look up reward totals) and nothing else.
 */
export function createSupabaseApi(config: { url: string; key: string; fetchImpl?: typeof fetch }) {
  const base = `${config.url}/rest/v1`;
  const doFetch = config.fetchImpl ?? fetch;
  // Older JWT-style keys are sent both ways; the newer sb_publishable_ keys go only in `apikey`.
  const headers: Record<string, string> = { apikey: config.key, 'content-type': 'application/json' };
  if (config.key.startsWith('eyJ')) headers.authorization = `Bearer ${config.key}`;

  async function call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await doFetch(`${base}${path}`, {
        method,
        headers: { ...headers, ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: res.status, json };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw new Error('The server took too long to answer.');
      throw new Error('Could not reach the server. Check your connection.');
    } finally {
      clearTimeout(timer);
    }
  }

  const messageOf = (json: unknown) => (json && typeof json === 'object' && 'message' in json ? String((json as { message: unknown }).message) : '');

  return {
    /** Stores the signed report for review. It is not checked yet, so the answer is "received", not "accepted". */
    async submitReport(signed: SignedReport): Promise<SubmitResult> {
      const r = signed.report;
      const res = await call('POST', '/reports', { hash: signed.hash, node: r.node, type: r.type, body: signed }, { prefer: 'return=minimal' });
      if (res.status === 201 || res.status === 200 || res.status === 204) return { accepted: true, pending: true, hash: signed.hash, reasons: [] };
      if (res.status === 409) return { accepted: false, hash: signed.hash, reasons: ['This report was already submitted.'] };
      const msg = messageOf(res.json);
      if (/too many|busy/i.test(msg)) return { accepted: false, reasons: [msg] };
      if (/reports_shape|violates check/i.test(msg)) return { accepted: false, reasons: ['The report is too large or malformed.'] };
      throw new Error(msg || `The server refused the report (HTTP ${res.status}).`);
    },

    async fetchChests(): Promise<Chest[]> {
      const res = await call('GET', '/chests?select=*&order=created_at.desc&limit=200');
      if (res.status !== 200 || !Array.isArray(res.json)) throw new Error(messageOf(res.json) || `Could not load chests (HTTP ${res.status}).`);
      return (res.json as Row[]).map(chestFromRow);
    },

    /** Adds an encrypted progress backup. The server cannot read it; see server/supabase/schema_backup.sql. */
    async putBackup(node: string, tag: string, payload: string): Promise<void> {
      const res = await call('POST', '/backups', { node, tag, payload }, { prefer: 'return=minimal' });
      if (res.status === 201 || res.status === 200 || res.status === 204) return;
      const msg = messageOf(res.json);
      if (res.status === 404 || /backups/i.test(msg) && /not find|does not exist/i.test(msg)) throw new Error('Backup is not set up on the server yet (run schema_backup.sql in Supabase).');
      if (/too many|busy/i.test(msg)) throw new Error(msg);
      if (/violates check/i.test(msg)) throw new Error('The backup is too large to store.');
      throw new Error(msg || `The server refused the backup (HTTP ${res.status}).`);
    },

    /** The newest backup for this wallet and tag, or null if there is none. */
    async fetchBackup(node: string, tag: string): Promise<{ payload: string; createdMs: number } | null> {
      const res = await call('POST', '/rpc/fetch_backup', { p_node: node, p_tag: tag });
      if (res.status === 404) throw new Error('Backup is not set up on the server yet (run schema_backup.sql in Supabase).');
      if (res.status !== 200) throw new Error(messageOf(res.json) || `Could not look for a backup (HTTP ${res.status}).`);
      const j = res.json as { payload?: string; created_ms?: number } | null;
      return j && typeof j.payload === 'string' ? { payload: j.payload, createdMs: Number(j.created_ms) || 0 } : null;
    },

    async fetchNodeSummary(address: string): Promise<NodeSummary> {
      const res = await call('POST', '/rpc/node_summary', { p_node: address });
      if (res.status !== 200 || !res.json) throw new Error(messageOf(res.json) || `Could not load earnings (HTTP ${res.status}).`);
      const j = res.json as { pendingReports?: number; rejectedReports?: number; pendingUsdc: number; approvedUsdc: number; paidUsdc: number; entries: NodeSummary['entries']; azmTotal?: number; verified?: NodeSummary['verified'] };
      return {
        address,
        totalUsdc: Number(j.pendingUsdc) + Number(j.approvedUsdc) + Number(j.paidUsdc),
        pendingReports: Number(j.pendingReports ?? 0),
        rejectedReports: Number(j.rejectedReports ?? 0),
        pendingUsdc: Number(j.pendingUsdc),
        approvedUsdc: Number(j.approvedUsdc),
        paidUsdc: Number(j.paidUsdc),
        entries: j.entries ?? [],
        seekerMint: null,
        azmTotal: Number(j.azmTotal ?? 0),
        verified: j.verified ?? [],
      };
    },

    /** Files a signed deletion request; the review job checks the signature and carries it out. */
    async deleteMyData(address: string, issuedAtMs: number, signature: string): Promise<DeleteResult> {
      const res = await call('POST', '/deletion_requests', { node: address, issued_ms: issuedAtMs, signature }, { prefer: 'return=minimal' });
      if (res.status === 201 || res.status === 200 || res.status === 204) return { ok: true, queued: true };
      const msg = messageOf(res.json);
      return { ok: false, error: /too many/i.test(msg) ? 'Too many requests. Try again later.' : msg || `The request was refused (HTTP ${res.status}).` };
    },
  };
}
