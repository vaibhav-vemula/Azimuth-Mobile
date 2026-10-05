import { useEffect, useState } from 'react';
import { createMMKV } from 'react-native-mmkv';

/** The Solana network where .skr names live (they are Seeker IDs, registered on mainnet whatever network the app signs on). */
const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const SKR = 'skr';
/** A name that was looked up is trusted for this long; a "no name" answer is trusted for less, so a new name shows up soon. */
const FOUND_TTL_MS = 7 * 24 * 3600_000;
const NONE_TTL_MS = 6 * 3600_000;

const storage = createMMKV({ id: 'azimuth-wallet' });
const key = (address: string) => `skr:${address}`;

interface Cached {
  name: string | null;
  at: number;
}

function readCache(address: string, now = Date.now()): Cached | null {
  try {
    const raw = storage.getString(key(address));
    if (!raw) return null;
    const c = JSON.parse(raw) as Cached;
    const ttl = c.name ? FOUND_TTL_MS : NONE_TTL_MS;
    return typeof c.at === 'number' && now - c.at < ttl ? c : null;
  } catch {
    return null;
  }
}

/** What the lookup needs from the AllDomains parser, so tests do not need the network. */
export interface DomainLookup {
  getMainDomain(address: string): Promise<{ tld: string; domain: string } | unknown>;
  getParsedAllUserDomainsFromTld(address: string, tld: string): Promise<{ domain?: string }[] | unknown>;
}

const clean = (domain: string) => domain.replace(/\.skr$/i, '').trim();
const asName = (domain: string | undefined | null) => {
  const label = domain ? clean(domain) : '';
  return label ? `${label}.skr` : null;
};

/**
 * The .skr name (the Seeker ID) of a wallet, or null if it has none. The main domain is used when it is a .skr one;
 * otherwise the first .skr name the wallet owns. Never throws: no network or no name both come back as null.
 */
export async function lookupSkrName(address: string, lookup: DomainLookup): Promise<string | null> {
  try {
    const main = (await lookup.getMainDomain(address)) as { tld?: string; domain?: string } | null;
    if (main && typeof main.domain === 'string' && String(main.tld ?? '').replace(/^\./, '').toLowerCase() === SKR) {
      const name = asName(main.domain);
      if (name) return name;
    }
  } catch {
    // No main domain set: fall through to the list.
  }
  try {
    const all = (await lookup.getParsedAllUserDomainsFromTld(address, SKR)) as { domain?: string }[] | null;
    const first = Array.isArray(all) ? all.map((d) => asName(d.domain)).find((n) => n !== null) : null;
    return first ?? null;
  } catch {
    return null;
  }
}

async function defaultLookup(): Promise<DomainLookup> {
  const [{ Connection }, { TldParser }] = await Promise.all([import('@solana/web3.js'), import('@onsol/tldparser')]);
  return new TldParser(new Connection(MAINNET_RPC, 'confirmed')) as unknown as DomainLookup;
}

/** Looks up (and remembers) a wallet's .skr name. Pass a lookup in tests. */
export async function resolveSkrName(address: string, lookup?: DomainLookup, now = Date.now()): Promise<string | null> {
  const cached = readCache(address, now);
  if (cached) return cached.name;
  let name: string | null = null;
  try {
    name = await lookupSkrName(address, lookup ?? (await defaultLookup()));
  } catch {
    return null; // not cached: try again next time
  }
  storage.set(key(address), JSON.stringify({ name, at: now } satisfies Cached));
  return name;
}

/** The .skr name of the connected wallet: the remembered one at once, then the fresh answer. */
export function useSkrName(address: string | null): string | null {
  const [name, setName] = useState<string | null>(() => (address ? readCache(address)?.name ?? null : null));
  useEffect(() => {
    if (!address) {
      setName(null);
      return;
    }
    let cancelled = false;
    setName(readCache(address)?.name ?? null);
    resolveSkrName(address).then((n) => {
      if (!cancelled) setName(n);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);
  return name;
}
