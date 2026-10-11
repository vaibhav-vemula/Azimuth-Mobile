'use strict';

/** Whole AZMTest amounts for approved reports. The token has 0 decimals, so everything here is an integer. */
const KIND = { mapping: 0, satellite: 1, chest: 2, challenge: 3 };
const TYPE_KIND = { 'mapping-session': KIND.mapping, 'satellite-pass': KIND.satellite, 'chest-claim': KIND.chest, 'challenge-claim': KIND.challenge };

/** A positive whole number from the environment, or the fallback. */
function whole(env, name, fallback) {
  const v = env[name];
  return typeof v === 'string' && /^[1-9]\d*$/.test(v.trim()) ? Number(v.trim()) : fallback;
}

function kindFor(type) {
  return Object.prototype.hasOwnProperty.call(TYPE_KIND, type) ? TYPE_KIND[type] : null;
}

function azmAmount({ type, rows, newCellUsdc }, env = process.env) {
  if (type === 'satellite-pass') return whole(env, 'AZM_SATELLITE', 25);
  if (type === 'chest-claim') return whole(env, 'AZM_CHEST', 10);
  if (type === 'mapping-session') {
    const usdc = (rows || []).filter((r) => r.kind === 'new-cells').reduce((n, r) => n + Number(r.amountUsdc), 0);
    const paidCells = newCellUsdc > 0 ? Math.round(usdc / newCellUsdc) : 0;
    const perToken = whole(env, 'AZM_CELLS_PER_TOKEN', 5);
    return Math.min(whole(env, 'AZM_MAPPING_MAX', 50), Math.floor(paidCells / perToken));
  }
  return 0;
}

module.exports = { KIND, kindFor, azmAmount };
