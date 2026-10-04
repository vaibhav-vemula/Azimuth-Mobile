'use strict';
const { openStore } = require('./lib/store');
const { createService } = require('./lib/service');
const { createServer } = require('./lib/http');
const { createRpc, createSeekerGate } = require('./lib/seeker');

const port = Number(process.env.PORT || 8787);
const store = openStore(process.env.DB_PATH || './azimuth.db');
// Set REQUIRE_SEEKER=1 and RPC_URL (a Solana mainnet RPC) to accept only Seeker Genesis Token holders.
// Optional review queue: accepted reports and their rewards are copied to Supabase as 'pending'. You approve them
// in the Supabase dashboard and a weekly script pays the approved ones. See server/supabase/schema.sql.
const sink = process.env.SUPABASE_URL
  ? require('./lib/supabase').createSupabaseSink({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_KEY })
  : undefined;
if (!sink) console.warn('SUPABASE_URL is not set: reports stay in the local database only and there is no review queue.');

const checkNode =
  process.env.REQUIRE_SEEKER === '1'
    ? createSeekerGate({ rpc: createRpc(process.env.RPC_URL || 'https://api.mainnet-beta.solana.com'), store })
    : undefined;
if (!checkNode) console.warn('REQUIRE_SEEKER is off: any wallet can submit. Fine for development, not for rewards.');
const service = createService(store, { checkNode, sink });
if (sink) {
  const retry = () => service.flushOutbox().then((r) => r.error && console.warn(`Supabase push waiting (${r.waiting} queued): ${r.error}`));
  retry();
  setInterval(retry, 60_000).unref();
}
// Optional: offer landed radiosondes near a region as recovery chests. SONDE_REGION="lat,lon,radiusKm".
if (process.env.SONDE_REGION) {
  const [lat, lon, radiusKm] = process.env.SONDE_REGION.split(',').map(Number);
  if ([lat, lon, radiusKm].every(Number.isFinite)) {
    const { syncSondes } = require('./lib/sondes');
    const run = () =>
      syncSondes({ service, store, region: { lat, lon, radiusKm } })
        .then((made) => made.length && console.log(`Sonde chests created: ${made.map((m) => m.serial).join(', ')}`))
        .catch((e) => console.warn(`Sonde sync failed: ${e.message}`));
    run();
    setInterval(run, 15 * 60_000).unref();
  } else {
    console.warn('SONDE_REGION must be "lat,lon,radiusKm"; sonde chests are off.');
  }
}

const server = createServer(service, { requesterKey: process.env.REQUESTER_KEY || null, operatorKey: process.env.OPERATOR_KEY || null });

server.listen(port, () => {
  console.log(`Azimuth verifier listening on :${port}`);
  if (!process.env.REQUESTER_KEY) console.warn('REQUESTER_KEY is not set: anyone can create bounties. Fine for local development only.');
});
