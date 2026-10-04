#!/usr/bin/env node
'use strict';
/**
 * Housekeeping for direct mode: syncs chests and carries out signed deletion requests. Reports are NOT decided
 * here: a person approves or rejects each one in the admin portal (npm run admin).
 *
 *   node --env-file=.env tools/review.js               one pass
 *   node --env-file=.env tools/review.js --watch 300   repeat every 300 seconds
 *   node --env-file=.env tools/review.js --auto        also approve every report that passes the checks, with no
 *                                                      person involved (rewards start as 'pending'). Off by default.
 *
 * Keep the REVIEW_DB file between runs: it remembers which cells and chests are already taken.
 */
const path = require('node:path');
const { openStore } = require('../lib/store');
const { createSupabaseSink } = require('../lib/supabase');
const { createReviewer } = require('../lib/review');
const { createRpc, createSeekerGate } = require('../lib/seeker');
const { fileTleProvider } = require('../lib/orbit');

const auto = process.argv.includes('--auto');
const watch = process.argv.includes('--watch') ? Number(process.argv[process.argv.indexOf('--watch') + 1]) : 0;

const sink = createSupabaseSink({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_KEY });
const store = openStore(process.env.REVIEW_DB || path.join(__dirname, '..', 'review.db'));
const checkNode =
  process.env.REQUIRE_SEEKER === '1'
    ? createSeekerGate({ rpc: createRpc(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com'), store })
    : undefined;
if (!checkNode) console.warn('REQUIRE_SEEKER is off: any wallet can earn. Fine for development.');

const reviewer = createReviewer({
  sink,
  store,
  checkNode,
  tleFor: fileTleProvider(path.join(__dirname, '..', 'data', 'tles.json')),
  log: (l) => console.log(l),
});

async function once() {
  const r = await reviewer.run({ auto });
  console.log(auto ? `auto-reviewed: ${r.verified} verified, ${r.rejected} rejected, ${r.deletions} deletions, ${r.chests} open chests` : `${r.waiting} submissions waiting for a person (npm run admin), ${r.deletions} deletions done, ${r.chests} open chests`);
}

(async () => {
  await once();
  while (watch > 0) {
    await new Promise((res) => setTimeout(res, watch * 1000));
    await once().catch((e) => console.warn(`review failed: ${e.message}`));
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
