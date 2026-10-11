'use strict';
const { openStore } = require('./store');
const { createService } = require('./service');
const { azmAmount, kindFor } = require('./azmRewards');
const { verifyEnvelope, verifyClaim } = require('./verify-report.cjs');
const { createChallengeSource, isClaimablePeriod, periodWindow, onchainHash, progressFor } = require('./challenges');

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
function createReviewer({ sink, store = openStore(':memory:'), checkNode, tleFor, config, chain = null, challenges = createChallengeSource({ sink }), azmEnv = process.env, log = () => undefined }) {
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
    if (envelope.report.type !== r.type) return ['the type column does not match the signed report'];
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

  /** Sends the AZMTest payout for a verified report and records the outcome. Never throws. */
  async function payOnChain(hash, node, type, amount, chainHash = hash) {
    let out;
    try {
      out = await chain.reward({ wallet: node, hash: chainHash, kind: kindFor(type), amount });
    } catch (e) {
      const error = String((e && e.message) || e).slice(0, 300);
      await sink.setOnchain(hash, { onchain_error: error }).catch(() => undefined);
      return { ok: false, amount, error };
    }
    try {
      await sink.setOnchain(hash, { onchain_tx: out.signature || 'already-recorded', onchain_record: out.record, onchain_error: null });
    } catch (e) {
      return { ok: true, amount, signature: out.signature, record: out.record, warning: `paid on-chain but could not save the result: ${String((e && e.message) || e).slice(0, 250)}` };
    }
    return { ok: true, amount, signature: out.signature, record: out.record };
  }

  /** Pays again a verified report whose payout failed. Safe to repeat: the program pays each report once. */
  async function retryOnChain(hash) {
    if (!chain) return { hash, status: 'failed', onchain: { ok: false, amount: 0, error: 'on-chain payouts are not configured' } };
    const r = await sink.getReport(hash);
    if (!r) return { hash, status: 'missing' };
    if (r.status !== 'verified') return { hash, status: 'not-verified' };
    if (r.onchain_tx) return { hash, status: 'already-paid' };
    const amount = Number(r.onchain_amount) || 0;
    if (kindFor(r.type) === null || amount <= 0) return { hash, status: 'nothing-to-pay' };
    const rep = r.body && r.body.report;
    const chainHash = r.type === 'challenge-claim' && rep ? onchainHash(String(rep.challengeId), String(rep.period)) : hash;
    const onchain = await payOnChain(hash, r.node, r.type, amount, chainHash);
    return { hash, status: onchain.ok ? 'paid' : 'failed', onchain };
  }

  /**
   * Accepts a report. With `auto` unset this is the person pressing Approve. A report that fails the automatic
   * checks cannot be approved (reject it instead); this keeps one mistaken click from paying out an implausible report.
   */
  async function approve(hash, { status = 'approved' } = {}) {
    const r = await sink.getReport(hash);
    if (!r) return { hash, status: 'missing', reasons: ['no such report'] };
    if (r.type === 'challenge-claim') return { hash, status: 'blocked', reasons: ['challenge claims are settled automatically'] };
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

    let onchain = null;
    if (chain && status === 'approved') {
      const amount = azmAmount({ type: r.type, rows, newCellUsdc: service.config.newCellUsdc }, azmEnv);
      if (amount > 0) {
        try {
          await sink.setOnchain(hash, { onchain_amount: amount });
          onchain = await payOnChain(hash, r.node, r.type, amount);
        } catch (e) {
          onchain = { ok: false, amount, error: 'Could not save the payout amount (nothing was sent): ' + String((e && e.message) || e).slice(0, 250) };
        }
      }
    }
    return { hash, status: 'verified', rewards: rows, onchain };
  }

  /** Settles one stored claim. Returns the outcome; never throws for a bad claim, only for storage failures. */
  async function settleClaim(r, nowMs) {
    const reject = async (reasons) => { await sink.finishReport(r.hash, 'rejected', reasons); return { hash: r.hash, status: 'rejected', reasons }; };
    const checked = verifyClaim(r.body);
    if (!checked.valid) return reject(checked.problems);
    const c = r.body.report;
    if (checked.hash !== r.hash) return reject(['the report hash column does not match the signed claim']);
    if (c.node !== r.node) return reject(['the wallet column does not match the signed claim']);
    if (r.type !== 'challenge-claim') return reject(['the type column does not match the signed claim']);
    const def = await challenges.get(c.challengeId);
    if (!def) return reject(['unknown challenge']);
    if (!isClaimablePeriod(def.period, c.period, nowMs)) return reject(['this period can no longer be claimed']);
    if (await sink.findVerifiedClaim(r.node, def.id, c.period)) return reject(['already claimed for this period']);

    const { fromMs, toMs } = periodWindow(def.period, c.period, nowMs);
    const [reports, rewards] = await Promise.all([
      sink.listVerifiedActivity(r.node, new Date(fromMs).toISOString(), new Date(toMs).toISOString()),
      sink.listNewCellRewards(r.node, new Date(fromMs).toISOString(), new Date(toMs).toISOString()),
    ]);
    let progress = progressFor(def.metric, { reports, rewards }, service.config.newCellUsdc);
    if (progress < def.goal) {
      // Not enough approved work yet. Submitted reports that nobody has reviewed also count, once they pass the same
      // automatic checks (signature, plausibility, freshness). Reports that fail them count for nothing.
      const waiting = await sink.listNewReportsFor(r.node, new Date(fromMs).toISOString(), new Date(toMs).toISOString());
      const passing = [];
      let bestNewCellsUsdc = 0;
      for (const w of waiting) {
        const p = await preview(w);
        if (!p.ok) continue;
        passing.push({ type: w.type, seconds: w.body && w.body.report && w.body.report.checks ? w.body.report.checks.durationSec : null });
        const usdc = (p.rewardRows || []).filter((x) => x.kind === 'new-cells').reduce((n, x) => n + Number(x.amountUsdc), 0);
        // Each report is judged against the same known cells, so two reports over the same ground would both look new.
        // Only the best one counts, so repeating a walk cannot add up.
        if (usdc > bestNewCellsUsdc) bestNewCellsUsdc = usdc;
      }
      progress = progressFor(def.metric, { reports: reports.concat(passing), rewards: bestNewCellsUsdc > 0 ? rewards.concat([{ amount_usdc: bestNewCellsUsdc }]) : rewards }, service.config.newCellUsdc);
    }
    if (progress < def.goal) return reject([`${progress} of ${def.goal} found by the server so far. Submit your sessions from the Map tab, then claim again.`]);

    try {
      await sink.setOnchain(r.hash, { onchain_amount: def.reward });
    } catch (e) {
      // Nothing is marked or sent: the claim stays new and is settled again on the next pass.
      return { hash: r.hash, status: 'skipped', reasons: [`Could not save the payout amount (nothing was sent): ${String((e && e.message) || e).slice(0, 250)}`] };
    }
    await sink.finishReport(r.hash, 'verified', null);
    const onchain = await payOnChain(r.hash, r.node, 'challenge-claim', def.reward, onchainHash(def.id, c.period));
    return { hash: r.hash, status: 'verified', onchain };
  }

  /** Settles every new challenge claim. Does nothing unless on-chain payouts are configured. */
  async function settleChallenges({ nowMs = Date.now(), limit = 50 } = {}) {
    if (!chain) return [];
    const out = [];
    for (const r of await sink.listNewClaims(limit)) {
      try { out.push(await settleClaim(r, nowMs)); } catch (e) { out.push({ hash: r.hash, status: 'skipped', reasons: [String((e && e.message) || e)] }); }
    }
    return out;
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

  return { run, preview, approve, reject, retryOnChain, settleChallenges, syncChests, processDeletions, service, store };
}

module.exports = { createReviewer, DELETION_MAX_AGE_MS };
