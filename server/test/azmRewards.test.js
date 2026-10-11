'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { azmAmount, kindFor, KIND } = require('../lib/azmRewards');

const cells = (n) => [{ kind: 'new-cells', ref: '', amountUsdc: Math.round(n * 0.001 * 1e6) / 1e6 }];
const base = { newCellUsdc: 0.001 };

test('mapping pays one token per 5 paid cells, capped at 50, whole numbers only', () => {
  assert.equal(azmAmount({ ...base, type: 'mapping-session', rows: cells(12) }, {}), 2);
  assert.equal(azmAmount({ ...base, type: 'mapping-session', rows: cells(4) }, {}), 0);
  assert.equal(azmAmount({ ...base, type: 'mapping-session', rows: cells(1000) }, {}), 50);
  assert.equal(azmAmount({ ...base, type: 'mapping-session', rows: [] }, {}), 0);
});

test('satellite pass and chest claim pay fixed amounts', () => {
  assert.equal(azmAmount({ ...base, type: 'satellite-pass', rows: [] }, {}), 25);
  assert.equal(azmAmount({ ...base, type: 'chest-claim', rows: [] }, {}), 10);
});

test('amounts can be changed by environment and bad values fall back to the defaults', () => {
  assert.equal(azmAmount({ ...base, type: 'satellite-pass', rows: [] }, { AZM_SATELLITE: '40' }), 40);
  assert.equal(azmAmount({ ...base, type: 'satellite-pass', rows: [] }, { AZM_SATELLITE: 'lots' }), 25);
  assert.equal(azmAmount({ ...base, type: 'satellite-pass', rows: [] }, { AZM_SATELLITE: '2.5' }), 25);
  assert.equal(azmAmount({ ...base, type: 'mapping-session', rows: cells(100) }, { AZM_CELLS_PER_TOKEN: '10', AZM_MAPPING_MAX: '8' }), 8);
});

test('unknown report types pay nothing and have no kind', () => {
  assert.equal(azmAmount({ ...base, type: 'mystery', rows: cells(100) }, {}), 0);
  assert.equal(kindFor('mystery'), null);
  assert.equal(kindFor('mapping-session'), KIND.mapping);
  assert.equal(kindFor('satellite-pass'), KIND.satellite);
  assert.equal(kindFor('chest-claim'), KIND.chest);
});
