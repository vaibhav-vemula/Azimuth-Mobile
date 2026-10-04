#!/usr/bin/env node
'use strict';
/**
 * Refreshes server/data/tles.json from CelesTrak, by catalogue number (searching by name misses Meteor-M2 4).
 *   node server/tools/update-tles.js [file]
 */
const fs = require('node:fs');
const path = require('node:path');

const SATELLITES = ['57166', '59051'];
const out = process.argv[2] || path.join(__dirname, '..', 'data', 'tles.json');

async function fetchTle(norad) {
  const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${norad}&FORMAT=tle`);
  if (!res.ok) throw new Error(`CelesTrak returned HTTP ${res.status} for ${norad}`);
  const lines = (await res.text()).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const l1 = lines.find((l) => l.startsWith('1 '));
  const l2 = lines.find((l) => l.startsWith('2 '));
  if (!l1 || !l2) throw new Error(`no TLE in the answer for ${norad}`);
  return { line1: l1, line2: l2 };
}

(async () => {
  const all = {};
  for (const norad of SATELLITES) all[norad] = await fetchTle(norad);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(all, null, 2) + '\n');
  console.log(`wrote ${Object.keys(all).length} TLEs to ${out}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
