'use strict';
const crypto = require('node:crypto');
const { verifyEnvelope } = require('./verify-report.cjs');
const { verifyMessage } = require('./verify-report.cjs');
const { checkReport, checkPassShape, cellAndNeighbours, hexDistance, parseCell } = require('./rules');
const { checkPassPhysics, fileTleProvider } = require('./orbit');
const path = require('node:path');

const HOUR = 3600_000;
const DAY = 24 * HOUR;

const DEFAULTS = {
  /** Subsidy for the first accepted measurement of a cell. Small, capped, and labelled as a subsidy. */
  newCellUsdc: 0.001,
  dailyNewCellCap: 100,
  maxReportsPerHour: 30,
  minChestSamples: 3,
};

const RADIO_KINDS = new Set(['weather-radio', 'noise']);
const DEFAULT_PASS_RADIUS_CELLS = 40;
const KINDS = new Set(['gap', 'dead-zone', 'wifi-quality', 'visit', 'weather-radio', 'noise', 'satellite-pass', 'sonde']);
const DONGLE_KINDS = new Set(['weather-radio', 'noise', 'satellite-pass', 'sonde']);
const DEFAULT_SONDE_RADIUS_CELLS = 8;

function sumOver(buckets, pick) {
  return buckets.reduce((n, b) => n + (pick(b) || 0), 0);
}

/** Business rules of the verifier. Pure over a store, so it can be tested without HTTP. */
function createService(store, options = {}) {
  const config = { ...DEFAULTS, ...options.config };
  const now = options.now || (() => Date.now());
  /** Optional identity gate, for example the Seeker Genesis Token check. Resolves { ok, reason }. */
  const checkNode = options.checkNode || (async () => ({ ok: true }));
  /** Orbit data for the physics check on satellite passes: (noradId) => { line1, line2 } | null. */
  const tleFor = options.tleFor || fileTleProvider(path.join(__dirname, '..', 'data', 'tles.json'));
  /** Optional copy of accepted reports and rewards to a review queue (Supabase). */
  const sink = options.sink || null;
  const { q } = store;

  function chestOutcome(report, bounty, t) {
    const problems = [];
    if (!bounty) return { problems: ['chest does not exist'] };
    if (bounty.status !== 'open' || bounty.fills >= bounty.max_fills) problems.push('chest is no longer open');
    if (bounty.expires_ms <= t) problems.push('chest has expired');
    if (report.chest.cellId !== bounty.cell_id) problems.push('report is for a different place than the chest');
    if (q.getClaim.get(bounty.id, report.node)) problems.push('this node already opened this chest');
    if (problems.length) return { problems };

    const spec = JSON.parse(bounty.spec);
    if (bounty.kind === 'satellite-pass') {
      if (report.type !== 'satellite-pass') return { problems: ['this chest needs a satellite pass receipt'] };
      const pass = report.pass;
      if (spec.noradId && pass.noradId !== String(spec.noradId)) problems.push(`this chest is for satellite ${spec.noradId}`);
      if (spec.windowStartMs && pass.endMs < spec.windowStartMs) problems.push('the pass was before this chest opened for passes');
      if (spec.windowEndMs && pass.startMs > spec.windowEndMs) problems.push('the pass was after this chest closed for passes');
      const here = parseCell(report.buckets[0].cellId);
      const target = parseCell(bounty.cell_id);
      const radius = spec.radiusCells || DEFAULT_PASS_RADIUS_CELLS;
      if (!here || !target || here.size !== target.size || hexDistance(here, target) > radius) problems.push('the receiver was too far from the place this chest asks for');
      return { problems };
    }
    if (report.type === 'satellite-pass') return { problems: ['a satellite pass receipt cannot open this kind of chest'] };

    if (bounty.kind === 'sonde') {
      if (!spec.frequencyHz) return { problems: ['this sonde chest has no frequency'] };
      const target = parseCell(bounty.cell_id);
      const radius = spec.radiusCells || DEFAULT_SONDE_RADIUS_CELLS;
      const heard = report.buckets.filter((b) => {
        const here = parseCell(b.cellId);
        return (
          b.sonde && b.sonde.detected > 0 && Math.abs(b.sonde.frequencyHz - spec.frequencyHz) <= 1000 &&
          here && target && here.size === target.size && hexDistance(here, target) <= radius &&
          b.bucketStartMs + 15 * 60_000 > bounty.created_ms
        );
      });
      if (heard.length === 0) problems.push('the sonde was not heard near its landing area');
      return { problems };
    }

    const near = new Set(cellAndNeighbours(bounty.cell_id));
    const buckets = report.buckets.filter((b) => near.has(b.cellId) && b.bucketStartMs + 15 * 60_000 > bounty.created_ms);
    const minSamples = spec.minSamples || config.minChestSamples;
    const samples = sumOver(buckets, (b) => b.samples);
    if (samples < minSamples) problems.push(`needs at least ${minSamples} readings at the chest, found ${samples}`);

    if (bounty.kind === 'gap' || bounty.kind === 'dead-zone') {
      if (sumOver(buckets, (b) => (b.cellular?.seen || 0) + (b.cellular?.none || 0)) < 2) problems.push('no cellular readings at the chest');
    } else if (bounty.kind === 'visit') {
      // A venue that placed a tag proves presence by its advertised name; without one, any readings at the spot count.
      if (spec.beaconName) {
        const heard = buckets.filter((b) => b.beacon && b.beacon.name === spec.beaconName && b.beacon.seen > 0 && b.beacon.rssiMax >= (spec.minRssi ?? -90));
        if (heard.length === 0) problems.push('the venue tag was not heard at the chest');
      }
    } else if (bounty.kind === 'wifi-quality') {
      if (sumOver(buckets, (b) => b.wifi?.samples) < 2) problems.push('no Wi-Fi readings at the chest');
    } else if (RADIO_KINDS.has(bounty.kind)) {
      if (sumOver(buckets, (b) => b.radio?.samples) < 1) problems.push('this chest needs a radio dongle reading');
    }
    return { problems, samples };
  }

  /**
   * Runs every check on a signed report and works out what accepting it would do, without changing anything.
   * { ok: false, hash, reasons, record } when something is wrong (record = worth keeping as a rejected row),
   * otherwise { ok: true, hash, report, chest, fresh, payable, rewardRows, reward }.
   */
  async function assess(envelope) {
    const t = now();
    const result = verifyEnvelope(envelope);
    const hash = result.hash;
    const bad = (reasons, record = true) => ({ ok: false, hash, reasons, record: record && !!hash && !!(envelope && envelope.report) });
    if (!result.valid) return bad(result.problems, false);

    const report = envelope.report;
    if (q.getReport.get(hash)) return bad(['this report was already submitted'], false);
    if (q.recentReports.get(report.node, t - HOUR).n >= config.maxReportsPerHour) return bad(['too many reports from this node this hour']);

    const identity = await checkNode(report.node);
    if (!identity.ok) return bad([identity.reason || 'node is not eligible']);

    const problems = checkReport(report, t);
    if (problems.length) return bad(problems);

    if (report.type === 'satellite-pass') {
      const passProblems = [...checkPassShape(report, t)];
      if (passProblems.length === 0) passProblems.push(...checkPassPhysics(report, tleFor));
      if (passProblems.length) return bad(passProblems);
    }

    let chest = null;
    if (report.type === 'chest-claim' || (report.type === 'satellite-pass' && report.chest)) {
      if (!report.chest || typeof report.chest.id !== 'string') return bad(['chest claim has no chest']);
      chest = chestOutcome(report, q.getBounty.get(report.chest.id), t);
      if (chest.problems.length) return bad(chest.problems);
    }

    // What accepting it would pay.
    const distinct = [...new Set(report.buckets.map((b) => b.cellId))];
    const fresh = distinct.filter((id) => !q.getCell.get(id));
    const usedToday = q.newCellsToday.get(report.node, t - DAY).n;
    const payable = fresh.slice(0, Math.max(0, config.dailyNewCellCap - usedToday));
    const rewardRows = [];
    if (payable.length > 0) rewardRows.push({ kind: 'new-cells', ref: '', amountUsdc: round6(payable.length * config.newCellUsdc) });
    const reward = { newCells: fresh.length, paidCells: payable.length, subsidyUsdc: round6(payable.length * config.newCellUsdc), chestUsdc: 0 };
    if (chest) {
      const bounty = q.getBounty.get(report.chest.id);
      reward.chestUsdc = bounty.reward_usdc;
      rewardRows.push({ kind: 'chest', ref: bounty.id, amountUsdc: bounty.reward_usdc });
    }
    return { ok: true, hash, report, chest, fresh, payable, rewardRows, reward };
  }

  /**
   * Checks a report and, unless `preview` is set, accepts it: records it, marks its cells known, fills the chest and
   * books the rewards. A preview answers "would this be accepted, and what would it pay?" and changes nothing.
   */
  async function submitReport(envelope, { preview = false } = {}) {
    const t = now();
    const a = await assess(envelope);
    if (!a.ok) {
      if (a.record && !preview) {
        try {
          q.insertReport.run(a.hash, String(envelope.report.node), String(envelope.report.type), t, 0, a.reasons.join('; '), JSON.stringify(envelope));
        } catch { /* already stored */ }
      }
      return { accepted: false, hash: a.hash, reasons: a.reasons };
    }
    if (preview) return { accepted: true, hash: a.hash, reasons: [], reward: a.reward, rewardRows: a.rewardRows, preview: true };

    const { hash, report, chest, fresh, payable, rewardRows, reward } = a;
    const outcome = store.transaction(() => {
      q.insertReport.run(hash, report.node, report.type, t, 1, null, JSON.stringify(envelope));
      for (const b of report.buckets) q.insertBucket.run(b.cellId, b.bucketStartMs, report.node, hash, JSON.stringify(b));
      for (const id of fresh) q.insertCell.run(id, hash, t);
      for (const id of payable) q.insertLedger.run(report.node, 'new-cell', id, config.newCellUsdc, t);
      if (chest) {
        const bounty = q.getBounty.get(report.chest.id);
        q.insertClaim.run(bounty.id, report.node, hash, t);
        q.bumpFill.run(bounty.id);
        q.insertLedger.run(report.node, 'chest', bounty.id, bounty.reward_usdc, t);
      }
      q.setRewards.run(JSON.stringify(rewardRows), hash);

      if (sink) {
        const cells = new Set(report.buckets.map((b) => b.cellId));
        q.enqueue.run(
          'report',
          JSON.stringify({
            hash, node: report.node, type: report.type, receivedMs: t, body: envelope,
            summary: { cells: cells.size, samples: report.checks.samples, device: report.device.model, chest: report.chest ? report.chest.id : null, newCells: fresh.length },
            rewards: rewardRows,
          }),
          t
        );
      }
      return { accepted: true, hash, reasons: [], reward };
    });
    if (sink) void flushOutbox().catch(() => undefined);
    return outcome;
  }

  let flushing = null;
  /**
   * Copies queued items to the review queue. Stops at the first failure so order is kept; the item stays queued
   * and is retried on the next flush. Resolves { sent, waiting }.
   */
  function flushOutbox(batch = 50) {
    if (!sink) return Promise.resolve({ sent: 0, waiting: 0 });
    if (flushing) return flushing;
    flushing = (async () => {
      let sent = 0;
      try {
        for (const item of q.nextOutbox.all(batch)) {
          try {
            const payload = JSON.parse(item.payload);
            if (item.kind === 'report') await sink.pushReport(payload);
            else if (item.kind === 'erase') await sink.eraseNode(payload.node);
            q.doneOutbox.run(item.id);
            sent += 1;
          } catch (e) {
            q.failOutbox.run(item.id);
            throw e;
          }
        }
      } catch (e) {
        return { sent, waiting: q.outboxSize.get().n, error: e.message };
      } finally {
        flushing = null;
      }
      return { sent, waiting: q.outboxSize.get().n };
    })();
    return flushing;
  }

  function createBounty(input) {
    const t = now();
    const errors = [];
    if (typeof input.title !== 'string' || !input.title.trim()) errors.push('title is required');
    if (!KINDS.has(input.kind)) errors.push(`kind must be one of ${[...KINDS].join(', ')}`);
    if (typeof input.cellId !== 'string' || !/^h\d+:-?\d+:-?\d+$/.test(input.cellId)) errors.push('cellId is invalid');
    if (!(input.rewardUsdc > 0)) errors.push('rewardUsdc must be positive');
    if (!Number.isInteger(input.maxFills) || input.maxFills < 1) errors.push('maxFills must be a positive integer');
    if (!(input.expiresMs > t)) errors.push('expiresMs must be in the future');
    if (typeof input.requester !== 'string' || !input.requester) errors.push('requester is required');
    if (input.onchainBounty !== undefined && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(input.onchainBounty))) errors.push('onchainBounty must be a base58 address');
    if (errors.length) return { ok: false, errors };

    const id = crypto.randomBytes(8).toString('hex');
    const requires = DONGLE_KINDS.has(input.kind) ? 'dongle' : 'phone';
    q.insertBounty.run(id, input.title.trim(), input.kind, input.cellId, input.rewardUsdc, input.maxFills, input.expiresMs, input.requester, requires, JSON.stringify(input.spec || {}), t, input.onchainBounty || null);
    return { ok: true, id };
  }

  /** Reward rows an accepted report earned, as recorded when it was accepted. Null if unknown. */
  function rewardsFor(hash) {
    const r = q.getReport.get(hash);
    return r && r.accepted && r.rewards ? JSON.parse(r.rewards) : null;
  }

  /** Whether a report was already accepted earlier (so a repeat is a retry, not a new report). */
  function wasAccepted(hash) {
    const r = q.getReport.get(hash);
    return !!(r && r.accepted);
  }

  /**
   * Loads a chest that lives elsewhere (the Supabase chests table) under its own id. Safe to repeat: an existing
   * chest keeps its local fill count.
   */
  function importBounty(row) {
    const requires = DONGLE_KINDS.has(row.kind) ? 'dongle' : 'phone';
    q.insertBountyWithId.run(
      String(row.id), String(row.title), String(row.kind), String(row.cell_id), Number(row.reward_usdc), Number(row.max_fills),
      Number(row.fills || 0), Date.parse(row.expires_at), String(row.requester), requires, JSON.stringify(row.spec || {}),
      Date.parse(row.created_at) || now(), row.onchain_bounty || null
    );
    const b = q.getBounty.get(String(row.id));
    return { id: b.id, fills: b.fills, status: b.status };
  }

  function bountyState(id) {
    const b = q.getBounty.get(id);
    return b ? { id: b.id, fills: b.fills, status: b.status } : null;
  }

  function listBounties() {
    return q.openBounties.all(now()).map((b) => ({
      id: b.id,
      title: b.title,
      kind: b.kind,
      cellId: b.cell_id,
      rewardUsdc: b.reward_usdc,
      remaining: b.max_fills - b.fills,
      expiresMs: b.expires_ms,
      requester: b.requester,
      requires: b.requires,
      spec: JSON.parse(b.spec),
    }));
  }

  function nodeSummary(address) {
    const seeker = q.getSeekerByNode.get(address);
    return {
      address,
      totalUsdc: round6(q.ledgerTotal.get(address).total),
      entries: q.ledgerForNode.all(address),
      seekerMint: seeker ? seeker.mint : null,
    };
  }

  /** Checks (and, if eligible, links) the node's Seeker Genesis Token on demand. */
  async function verifyNode(address) {
    const result = await checkNode(address);
    return { eligible: !!result.ok, mint: result.mint || null, reason: result.ok ? null : result.reason || 'not eligible' };
  }

  /** Chest rewards accepted by the verifier and not yet paid on-chain. */
  function pendingSettlements() {
    return q.pendingSettlements.all().map((r) => ({
      ledgerId: r.ledger_id,
      node: r.node,
      onchainBounty: r.onchain_bounty,
      reportHash: r.report_hash,
      amountUsdc: r.amount_usdc,
    }));
  }

  function markSettled(ledgerId, tx) {
    if (typeof tx !== 'string' || tx.length < 20) return { ok: false, error: 'tx signature is required' };
    const r = q.markSettled.run(tx, ledgerId);
    return { ok: Number(r.changes) === 1 };
  }

  /**
   * Erases the location and measurement data held for a node, on the node's own signed request. What stays is
   * the minimum needed to stop fraud and to pay what is owed: report hashes (so a report cannot be replayed),
   * chest claims, the Seeker link, and the earnings ledger. None of those hold readings or places.
   */
  function deleteNodeData(address, issuedAtMs, signature, maxAgeMs = 5 * 60_000) {
    const t = now();
    if (!Number.isFinite(issuedAtMs) || Math.abs(t - issuedAtMs) > maxAgeMs) return { ok: false, error: 'the request is too old; try again' };
    if (!verifyMessage(address, `azimuth-delete-v1\n${address}\n${issuedAtMs}`, signature)) return { ok: false, error: 'the signature does not match this wallet' };
    const result = store.transaction(() => {
      const buckets = q.bucketsOfNode.get(address).n;
      const reports = q.reportsOfNode.get(address).n;
      q.deleteBucketsOfNode.run(address);
      q.blankReportsOfNode.run(address);
      if (sink) q.enqueue.run('erase', JSON.stringify({ node: address }), t);
      return { ok: true, deletedBuckets: buckets, deletedReports: reports };
    });
    if (result.ok && sink) void flushOutbox().catch(() => undefined);
    return result;
  }

  function knownCells() {
    return q.allCells.all().map((r) => r.cell_id);
  }

  function cellHistory(cellId) {
    return q.bucketsForCell.all(cellId).map((r) => ({ bucketMs: r.bucket_ms, ...JSON.parse(r.body) }));
  }

  return { submitReport, createBounty, listBounties, nodeSummary, verifyNode, deleteNodeData, rewardsFor, wasAccepted, importBounty, bountyState, pendingSettlements, markSettled, flushOutbox, knownCells, cellHistory, config };
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

module.exports = { createService, DEFAULTS, KINDS };
