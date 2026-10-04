#!/usr/bin/env node
'use strict';
/**
 * Creates a chest in Supabase from the command line.
 *
 *   node --env-file=.env tools/create-chest.js --title "Wi-Fi at Main St Cafe" --kind wifi-quality \
 *     --lat 38.9072 --lon -77.0369 --reward 0.5 --fills 5 --days 7 --requester "Main St Cafe" \
 *     [--beacon azm-maincafe] [--norad 59051] [--onchain <bounty address>]
 *
 * Kinds: gap, dead-zone, wifi-quality, visit, weather-radio, noise, satellite-pass.
 * (Sonde chests are created by the sonde sync, not by hand.)
 */
const { createSupabaseSink } = require('../lib/supabase');
const { cellIdAt } = require('../public/hex.js');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];

const need = (k) => {
  if (!args[k]) { console.error(`Missing --${k}`); process.exit(2); }
  return args[k];
};
const kind = need('kind');
const dongle = ['weather-radio', 'noise', 'satellite-pass'].includes(kind);
const spec = {};
if (args.beacon) spec.beaconName = args.beacon;
if (args.norad) { spec.noradId = args.norad; spec.windowStartMs = Date.now(); spec.windowEndMs = Date.now() + Number(args.days || 7) * 86400000; }

const row = {
  title: need('title'),
  kind,
  cell_id: cellIdAt(Number(need('lat')), Number(need('lon'))),
  reward_usdc: Number(need('reward')),
  max_fills: Number(need('fills')),
  expires_at: new Date(Date.now() + Number(args.days || 7) * 86400000).toISOString(),
  requester: need('requester'),
  requires: dongle ? 'dongle' : 'phone',
  spec,
  onchain_bounty: args.onchain || null,
};

createSupabaseSink({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_KEY })
  .createChest(row)
  .then((c) => console.log(`created chest ${c.id} at ${c.cell_id}`))
  .catch((e) => { console.error(e.message); process.exit(1); });
