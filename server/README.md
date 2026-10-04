# Azimuth verifier

A standalone Node service. It is not part of the phone app and is never bundled into it. It needs Node 22.12 or newer; SQLite comes built into Node, so the only dependency is `satellite.js` (for the satellite-pass orbit check).

```bash
cd server
npm install
npm start                 # port 8787, database ./azimuth.db
npm test                  # 42 tests
npm run update-tles       # refresh Meteor orbit data in data/tles.json
```

- Requester console: `http://localhost:8787/console`
- Privacy policy draft: `http://localhost:8787/privacy`
- Review queue: `supabase/schema.sql` (run once in the Supabase SQL editor)

Settings come from environment variables, or from a `server/.env` file loaded with `node --env-file=.env index.js`:

| Variable | Meaning |
|----------|---------|
| `PORT`, `DB_PATH` | listen port (8787) and SQLite file |
| `REQUESTER_KEY` | API key needed to create chests; unset means anyone can (development only) |
| `OPERATOR_KEY` | enables the on-chain settlement endpoints |
| `REQUIRE_SEEKER=1`, `RPC_URL` | accept only wallets holding a Seeker Genesis Token |
| `SONDE_REGION="lat,lon,radiusKm"` | offer landed radiosondes as chests |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | copy accepted reports and rewards to the Supabase review queue |

Two ways to use this folder:

- **Verifier service** (`npm start`): checks reports the moment the app sends them.
- **Admin portal** (`npm run admin`): for direct mode, where the app writes to Supabase itself. A page on your own computer where you look at every submission and approve or reject it. Needs `ADMIN_PASSWORD`.
- **Housekeeping** (`npm run review`): syncs chests and carries out signed deletion requests. Also `npm run create-chest -- --title ... --kind ... --lat ... --lon ... --reward ... --fills ... --requester ...`.

Run it anywhere that runs Node (a small VM, Fly.io, Railway, a container). The phone app only needs its public address, set at build time as `EXPO_PUBLIC_VERIFIER_URL`.
