'use strict';
const { DatabaseSync } = require('node:sqlite');

/** All persistent state of the verifier service. SQLite via Node's built-in driver, no dependencies. */
function openStore(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS reports (
      hash TEXT PRIMARY KEY,
      node TEXT NOT NULL,
      type TEXT NOT NULL,
      received_ms INTEGER NOT NULL,
      accepted INTEGER NOT NULL,
      reason TEXT,
      body TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reports_node ON reports(node, received_ms);
    -- A cell is "known to the network" once an accepted report covers it.
    CREATE TABLE IF NOT EXISTS cells (
      cell_id TEXT PRIMARY KEY,
      first_report TEXT NOT NULL,
      first_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS buckets (
      cell_id TEXT NOT NULL,
      bucket_ms INTEGER NOT NULL,
      node TEXT NOT NULL,
      report_hash TEXT NOT NULL,
      body TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS buckets_cell ON buckets(cell_id, bucket_ms);
    CREATE TABLE IF NOT EXISTS bounties (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      cell_id TEXT NOT NULL,
      reward_usdc REAL NOT NULL,
      max_fills INTEGER NOT NULL,
      fills INTEGER NOT NULL DEFAULT 0,
      expires_ms INTEGER NOT NULL,
      requester TEXT NOT NULL,
      requires TEXT NOT NULL,
      spec TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_ms INTEGER NOT NULL,
      onchain_bounty TEXT
    );
    CREATE TABLE IF NOT EXISTS claims (
      bounty_id TEXT NOT NULL,
      node TEXT NOT NULL,
      report_hash TEXT NOT NULL,
      created_ms INTEGER NOT NULL,
      PRIMARY KEY (bounty_id, node)
    );
    -- Rewards owed. Settlement on-chain is a separate step; this is the accounting record.
    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node TEXT NOT NULL,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      amount_usdc REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_ms INTEGER NOT NULL,
      tx TEXT
    );
    CREATE INDEX IF NOT EXISTS ledger_node ON ledger(node);
    -- Things still to be copied to Supabase. A failed push waits here and is retried, so nothing is lost.
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_ms INTEGER NOT NULL
    );
    -- Sondes already turned into chests, so each balloon is offered once.
    CREATE TABLE IF NOT EXISTS sonde_chests (
      serial TEXT PRIMARY KEY,
      bounty_id TEXT NOT NULL,
      created_ms INTEGER NOT NULL
    );
    -- One Seeker Genesis Token mint may belong to only one node.
    CREATE TABLE IF NOT EXISTS seekers (
      mint TEXT PRIMARY KEY,
      node TEXT NOT NULL,
      bound_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS seekers_node ON seekers(node);
  `);

  // Older databases predate this column.
  try { db.exec('ALTER TABLE reports ADD COLUMN rewards TEXT'); } catch { /* already there */ }

  const q = {
    insertReport: db.prepare('INSERT INTO reports (hash,node,type,received_ms,accepted,reason,body) VALUES (?,?,?,?,?,?,?)'),
    getReport: db.prepare('SELECT hash, accepted, reason, rewards FROM reports WHERE hash = ?'),
    setRewards: db.prepare('UPDATE reports SET rewards = ? WHERE hash = ?'),
    insertBountyWithId: db.prepare(
      'INSERT OR IGNORE INTO bounties (id,title,kind,cell_id,reward_usdc,max_fills,fills,expires_ms,requester,requires,spec,created_ms,onchain_bounty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ),
    recentReports: db.prepare('SELECT COUNT(*) AS n FROM reports WHERE node = ? AND received_ms > ?'),
    getCell: db.prepare('SELECT cell_id FROM cells WHERE cell_id = ?'),
    insertCell: db.prepare('INSERT OR IGNORE INTO cells (cell_id, first_report, first_ms) VALUES (?,?,?)'),
    insertBucket: db.prepare('INSERT INTO buckets (cell_id,bucket_ms,node,report_hash,body) VALUES (?,?,?,?,?)'),
    bucketsForCell: db.prepare('SELECT bucket_ms, node, body FROM buckets WHERE cell_id = ? ORDER BY bucket_ms'),
    allCells: db.prepare('SELECT cell_id FROM cells'),
    insertBounty: db.prepare(
      'INSERT INTO bounties (id,title,kind,cell_id,reward_usdc,max_fills,expires_ms,requester,requires,spec,created_ms,onchain_bounty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    ),
    getBounty: db.prepare('SELECT * FROM bounties WHERE id = ?'),
    openBounties: db.prepare("SELECT * FROM bounties WHERE status = 'open' AND expires_ms > ? AND fills < max_fills ORDER BY created_ms DESC"),
    bumpFill: db.prepare("UPDATE bounties SET fills = fills + 1, status = CASE WHEN fills + 1 >= max_fills THEN 'filled' ELSE status END WHERE id = ?"),
    getClaim: db.prepare('SELECT * FROM claims WHERE bounty_id = ? AND node = ?'),
    insertClaim: db.prepare('INSERT INTO claims (bounty_id,node,report_hash,created_ms) VALUES (?,?,?,?)'),
    insertLedger: db.prepare('INSERT INTO ledger (node,kind,ref,amount_usdc,created_ms) VALUES (?,?,?,?,?)'),
    pendingSettlements: db.prepare(
      `SELECT l.id AS ledger_id, l.node AS node, l.amount_usdc AS amount_usdc, b.onchain_bounty AS onchain_bounty, c.report_hash AS report_hash
       FROM ledger l
       JOIN bounties b ON b.id = l.ref
       JOIN claims c ON c.bounty_id = l.ref AND c.node = l.node
       WHERE l.kind = 'chest' AND l.status = 'pending' AND b.onchain_bounty IS NOT NULL
       ORDER BY l.id LIMIT 50`
    ),
    markSettled: db.prepare("UPDATE ledger SET status = 'settled', tx = ? WHERE id = ? AND status = 'pending'"),
    ledgerForNode: db.prepare('SELECT kind, ref, amount_usdc, status, created_ms FROM ledger WHERE node = ? ORDER BY id DESC LIMIT 100'),
    ledgerTotal: db.prepare("SELECT COALESCE(SUM(amount_usdc),0) AS total FROM ledger WHERE node = ?"),
    getSeekerByMint: db.prepare('SELECT mint, node FROM seekers WHERE mint = ?'),
    getSeekerByNode: db.prepare('SELECT mint, node FROM seekers WHERE node = ?'),
    insertSeeker: db.prepare('INSERT INTO seekers (mint,node,bound_ms) VALUES (?,?,?)'),
    getSondeChest: db.prepare('SELECT serial FROM sonde_chests WHERE serial = ?'),
    insertSondeChest: db.prepare('INSERT INTO sonde_chests (serial,bounty_id,created_ms) VALUES (?,?,?)'),
    sondeChestsSince: db.prepare('SELECT COUNT(*) AS n FROM sonde_chests WHERE created_ms > ?'),
    bucketsOfNode: db.prepare('SELECT COUNT(*) AS n FROM buckets WHERE node = ?'),
    deleteBucketsOfNode: db.prepare('DELETE FROM buckets WHERE node = ?'),
    reportsOfNode: db.prepare('SELECT COUNT(*) AS n FROM reports WHERE node = ?'),
    blankReportsOfNode: db.prepare("UPDATE reports SET body = '{\"deleted\":true}' WHERE node = ?"),
    enqueue: db.prepare('INSERT INTO outbox (kind,payload,created_ms) VALUES (?,?,?)'),
    nextOutbox: db.prepare('SELECT id, kind, payload, attempts FROM outbox ORDER BY id LIMIT ?'),
    doneOutbox: db.prepare('DELETE FROM outbox WHERE id = ?'),
    failOutbox: db.prepare('UPDATE outbox SET attempts = attempts + 1 WHERE id = ?'),
    outboxSize: db.prepare('SELECT COUNT(*) AS n FROM outbox'),
    newCellsToday: db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE node = ? AND kind = 'new-cell' AND created_ms > ?"),
  };

  return {
    db,
    q,
    transaction(fn) {
      db.exec('BEGIN');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    close() {
      db.close();
    },
  };
}

module.exports = { openStore };
