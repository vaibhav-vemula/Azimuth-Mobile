import { lookupSkrName, resolveSkrName } from '../skrName';

const main = (domain: string, tld = 'skr') => ({ nameAccount: 'x', tld, domain });

describe('finding a .skr name', () => {
  it('uses the main domain when it is a .skr one', async () => {
    const lookup = { getMainDomain: jest.fn(async () => main('vaibhav')), getParsedAllUserDomainsFromTld: jest.fn() };
    expect(await lookupSkrName('A', lookup)).toBe('vaibhav.skr');
    expect(lookup.getParsedAllUserDomainsFromTld).not.toHaveBeenCalled();
  });

  it('does not double the suffix, and accepts a dot in front of the tld', async () => {
    expect(await lookupSkrName('A', { getMainDomain: async () => main('vaibhav.skr', '.skr'), getParsedAllUserDomainsFromTld: jest.fn() })).toBe('vaibhav.skr');
  });

  it('falls back to the first .skr name when the main domain is another tld', async () => {
    const lookup = { getMainDomain: async () => main('someone', 'abc'), getParsedAllUserDomainsFromTld: jest.fn(async () => [{ domain: 'first.skr' }, { domain: 'second' }]) };
    expect(await lookupSkrName('A', lookup)).toBe('first.skr');
    expect(lookup.getParsedAllUserDomainsFromTld).toHaveBeenCalledWith('A', 'skr');
  });

  it('falls back to the list when there is no main domain at all', async () => {
    const lookup = {
      getMainDomain: async () => {
        throw new Error('not found');
      },
      getParsedAllUserDomainsFromTld: async () => [{ domain: 'only' }],
    };
    expect(await lookupSkrName('A', lookup)).toBe('only.skr');
  });

  it('is null when the wallet has no .skr name, or the lookup fails', async () => {
    expect(await lookupSkrName('A', { getMainDomain: async () => main('x', 'abc'), getParsedAllUserDomainsFromTld: async () => [] })).toBeNull();
    const broken = {
      getMainDomain: async () => {
        throw new Error('offline');
      },
      getParsedAllUserDomainsFromTld: async () => {
        throw new Error('offline');
      },
    };
    expect(await lookupSkrName('A', broken)).toBeNull();
  });
});

describe('remembering the name', () => {
  const lookupFor = (name: string | null) => {
    const getMainDomain = jest.fn(async () => (name ? main(name) : main('x', 'abc')));
    return { getMainDomain, getParsedAllUserDomainsFromTld: jest.fn(async () => []) };
  };

  it('asks once and then answers from memory', async () => {
    const lookup = lookupFor('remembered');
    const t = 1_700_000_000_000;
    expect(await resolveSkrName('W1', lookup, t)).toBe('remembered.skr');
    expect(await resolveSkrName('W1', lookup, t + 1000)).toBe('remembered.skr');
    expect(lookup.getMainDomain).toHaveBeenCalledTimes(1);
  });

  it('asks again after a "no name" answer has gone stale, so a new name shows up', async () => {
    const lookup = lookupFor(null);
    const t = 1_700_000_000_000;
    expect(await resolveSkrName('W2', lookup, t)).toBeNull();
    await resolveSkrName('W2', lookup, t + 3600_000);
    expect(lookup.getMainDomain).toHaveBeenCalledTimes(1);
    await resolveSkrName('W2', lookup, t + 7 * 3600_000);
    expect(lookup.getMainDomain).toHaveBeenCalledTimes(2);
  });

  it('keeps names of different wallets apart', async () => {
    const t = 1_700_000_000_000;
    expect(await resolveSkrName('W3', lookupFor('alice'), t)).toBe('alice.skr');
    expect(await resolveSkrName('W4', lookupFor('bob'), t)).toBe('bob.skr');
  });
});
