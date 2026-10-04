'use strict';
const { openStore } = require('./store');
const { createService } = require('./service');
const { verifyEnvelope } = require('./verify-report.cjs');

const DAY = 24 * 3600_000;
/** A deletion request stays valid this long, because review runs in batches rather than instantly. */
const DELETION_MAX_AGE_MS = 7 * DAY;

/**
 * Review of reports the app inserted into Supabase with the public key. Nothing is checked when a report arrives;
 * this is where it happens, and a person decides.
 *
 *  - preview(report): runs every automatic check as advice and shows what approving would pay. Changes nothing.
 *  - approve(hash):   commits it (cells become known, the chest fills) and creates APPROVED rewards, ready for the
 *                     weekly payout. Only possible when the automatic checks pass.
 *  - reject(hash):    records why. No reward.
 *  - run({auto}):     syncs chests and carries out signed deletion requests. With auto, also approves every report
 *                     that passes the checks, without a person.
 *
 * Each report is judged as of the time it was received, so review delays never turn a good report into an expired
 * one. Local state (known cells, chest claims) lives in a SQLite file that must be kept between runs.
 */
function createReviewer({ sink, store = openStore(':memory:'), checkNode, tleFor, config, log = () => undefined }) {
  const clock = { t: Date.now() };
  const service = createService(store, { now: () => clock.t, checkNode, tleFor, config });

  async function syncChests() {
    const chests = await sink.listChests();
    for (const c of chests) service.importBounty(c);
    return chests.length;
  }

  /** Checks that only apply because the app filled in the columns itself. Returns problems. */
  function columnProblems(r) {
    const envelope = r.body;
    if (!envelope || !envelope.report) return ['the report body is missing'];
    const checked = verifyEnvelope(envelope);
    if (checked.hash && checked.hash !== r.hash) return ['the report hash column does not match the signed report'];
    if (envelope.report.node !== r.node) return ['the wallet column does not match the signed report'];
    return [];
  }

  /** What the automatic checks say about a stored report. Nothing is changed. */
  async function preview(r) {
    const problems = columnProblems(r);
    if (problems.length) return { ok: false, reasons: problems };
    clock.t = Date.parse(r.received_at) || Date.now();
    if (service.wasAccepted(r.hash)) return { ok: true, reasons: [], reward: null, rewardRows: service.rewardsFor(r.hash) || [], alreadyCommitted: true };
    const out = await service.submitReport(r.body, { preview: true });
    return out.accepted ? { ok: true, reasons: [], reward: out.reward, rewardRows: out.rewardRows } : { ok: false, reasons: out.reasons };
  }

  async function reject(hash, reasons) {
    const list = Array.isArray(reasons) ? reasons : [String(reasons || 'rejected by reviewer')];
    await sink.finishReport(hash, 'rejected', list);
    return { hash, status: 'rejected', reasons: list };
  }

  /**
   * Accepts a report. With `auto` unset this is the person pressing Approve. A report that fails the automatic
   * checks cannot be approved (reject it instead); this keeps one mistaken click from paying out an implausible report.
   */
  async function approve(hash, { status = 'approved' } = {}) {
    const r = await sink.getReport(hash);
    if (!r) return { hash, status: 'missing', reasons: ['no such report'] };
    if (r.status !== 'new') return { hash, status: 'unchanged', current: r.status, reasons: [`this report was already ${r.status}`] };

    const problems = columnProblems(r);
    if (problems.length) return { hash, status: 'blocked', reasons: problems };

    clock.t = Date.parse(r.received_at) || Date.now();
    let rows;
    if (service.wasAccepted(hash)) {
      // Committed by an earlier attempt that stopped before recording the result: finish the bookkeeping.
      rows = service.rewardsFor(hash) || [];
    } else {
      const out = await service.submitReport(r.body);
      if (!out.accepted) return { hash, status: 'blocked', reasons: out.reasons };
      rows = service.rewardsFor(hash) || [];
    }

    const chestId = r.body.report.chest && r.body.report.chest.id;
    if (chestId) {
      const state = service.bountyState(chestId);
      if (state) await sink.updateChest(chestId, { fills: state.fills, ...(state.status === 'filled' ? { status: 'filled' } : {}) });
    }
    await sink.insertRewards(hash, r.node, rows, status);
    await sink.finishReport(hash, 'verified', null);
    return { hash, status: 'verified', rewards: rows };
  }

  async function processDeletions() {
    const done = [];
    for (const d of await sink.listDeletionRequests()) {
      clock.t = Date.now();
      const out = service.deleteNodeData(d.node, Number(d.issued_ms), d.signature, DELETION_MAX_AGE_MS);
      if (out.ok) {
        await sink.eraseNode(d.node);
        await sink.finishDeletion(d.id, 'done', `removed ${out.deletedBuckets} readings`);
      } else {
        await sink.finishDeletion(d.id, 'refused', out.error);
      }
      done.push({ id: d.id, ok: out.ok });
    }
    return done;
  }

  /**
   * One pass: sync chests, carry out deletion requests, and (only with auto) approve or reject every new report by
   * the rules alone. Without auto, new reports are left for a person.
   */
  async function run({ auto = false, batch = 100 } = {}) {
    const chests = await syncChests();
    const results = [];
    if (auto) {
      for (const r of await sink.listNewReports(batch)) {
        const p = await preview(r);
        const res = p.ok ? await approve(r.hash, { status: 'pending' }) : await reject(r.hash, p.reasons);
        log(`${res.status.padEnd(8)} ${r.hash.slice(0, 12)}  ${res.reasons ? res.reasons.join('; ') : ''}`);
        results.push(res);
      }
    }
    const deletions = await processDeletions();
    const waiting = auto ? 0 : (await sink.listNewReports(batch)).length;
    return {
      chests,
      verified: results.filter((x) => x.status === 'verified').length,
      rejected: results.filter((x) => x.status === 'rejected').length,
      deletions: deletions.length,
      waiting,
      results,
    };
  }

  return { run, preview, approve, reject, syncChests, processDeletions, service, store };
}

module.exports = { createReviewer, DELETION_MAX_AGE_MS };
