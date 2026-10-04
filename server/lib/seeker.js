'use strict';

/** Known addresses from the Solana Mobile Seeker Genesis Token documentation. */
const SGT_METADATA_ADDRESS = 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te';
const SGT_GROUP_ADDRESS = 'GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/** Minimal JSON-RPC client. `fetchImpl` is injectable so tests need no network. */
function createRpc(url, fetchImpl = fetch) {
  let id = 0;
  return async function rpc(method, params) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    });
    if (!res.ok) throw new Error(`RPC ${method} failed with HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`RPC ${method}: ${body.error.message}`);
    return body.result;
  };
}

function isSeekerMint(mintInfo) {
  const extensions = mintInfo?.data?.parsed?.info?.extensions;
  if (!Array.isArray(extensions)) return false;
  const pointer = extensions.find((e) => e.extension === 'metadataPointer');
  const member = extensions.find((e) => e.extension === 'tokenGroupMember');
  return pointer?.state?.metadataAddress === SGT_METADATA_ADDRESS && member?.state?.group === SGT_GROUP_ADDRESS;
}

/**
 * Finds a Seeker Genesis Token held by `owner`. Zero-balance accounts are ignored because transferring an SGT
 * leaves the old token account open. Resolves the mint address or null.
 */
async function findSeekerMint(rpc, owner) {
  const accounts = await rpc('getTokenAccountsByOwner', [owner, { programId: TOKEN_2022_PROGRAM }, { encoding: 'jsonParsed' }]);
  for (const entry of accounts?.value ?? []) {
    const info = entry.account?.data?.parsed?.info;
    if (!info || Number(info.tokenAmount?.amount) < 1) continue;
    const mint = await rpc('getAccountInfo', [info.mint, { encoding: 'jsonParsed' }]);
    if (isSeekerMint(mint?.value)) return info.mint;
  }
  return null;
}

/**
 * Gate for the service: the node must hold an SGT, and each SGT mint may serve only one node. Anti-sybil
 * depends on recording the mint, not just checking that some wallet holds one.
 */
function createSeekerGate({ rpc, store, now = () => Date.now() }) {
  const { q } = store;
  return async function checkNode(address) {
    const bound = q.getSeekerByNode.get(address);
    let mint;
    try {
      mint = await findSeekerMint(rpc, address);
    } catch (e) {
      return { ok: false, reason: 'could not check for a Seeker Genesis Token right now' };
    }
    if (!mint) return { ok: false, reason: 'this wallet does not hold a Seeker Genesis Token' };
    if (bound && bound.mint !== mint) return { ok: false, reason: 'this node is already linked to a different Seeker' };

    const owner = q.getSeekerByMint.get(mint);
    if (owner && owner.node !== address) return { ok: false, reason: 'this Seeker is already linked to another node' };
    if (!owner) q.insertSeeker.run(mint, address, now());
    return { ok: true, mint };
  };
}

module.exports = { createRpc, findSeekerMint, createSeekerGate, isSeekerMint, SGT_METADATA_ADDRESS, SGT_GROUP_ADDRESS, TOKEN_2022_PROGRAM };
