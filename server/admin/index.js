'use strict';
/**
 * Admin portal: a page on your own computer where you look at every submission and approve or reject it.
 *
 *   ADMIN_PASSWORD=choose-a-long-password node --env-file=.env admin/index.js
 *   then open http://127.0.0.1:8788
 *
 * It listens on this computer only. If you ever put it on a network, put HTTPS in front of it first: the password
 * and the reports pass through it.
 */
const http = require('node:http');
const path = require('node:path');
const { openStore } = require('../lib/store');
const { createSupabaseSink } = require('../lib/supabase');
const { createReviewer } = require('../lib/review');
const { createRpc, createSeekerGate } = require('../lib/seeker');
const { fileTleProvider } = require('../lib/orbit');
const { createAdminApp } = require('./app');

const host = process.env.ADMIN_HOST || '127.0.0.1';
const port = Number(process.env.ADMIN_PORT || 8788);

const sink = createSupabaseSink({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_KEY });
const store = openStore(process.env.REVIEW_DB || path.join(__dirname, '..', 'review.db'));
const checkNode =
  process.env.REQUIRE_SEEKER === '1'
    ? createSeekerGate({ rpc: createRpc(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com'), store })
    : undefined;
const reviewer = createReviewer({ sink, store, checkNode, tleFor: fileTleProvider(path.join(__dirname, '..', 'data', 'tles.json')) });

const handle = createAdminApp({ reviewer, sink, password: process.env.ADMIN_PASSWORD });
http.createServer(handle).listen(port, host, () => {
  console.log(`Admin portal on http://${host}:${port}`);
  if (host !== '127.0.0.1') console.warn('The portal is reachable from other computers. Put HTTPS in front of it.');
});
