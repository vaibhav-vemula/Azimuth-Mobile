import { findPassById, passId } from './passId';

const make = (noradId: string, iso: string) => {
  const riseTime = new Date(iso);
  return { noradId, riseTime, id: passId(noradId, riseTime) };
};

describe('passId', () => {
  it('is stable against sub-minute jitter in the refined rise time', () => {
    expect(passId('59051', new Date('2026-10-02T19:20:00.100Z'))).toBe(passId('59051', new Date('2026-10-02T19:20:00.900Z')));
  });

  it('differs between satellites and between passes', () => {
    expect(passId('59051', new Date('2026-10-02T19:20:00Z'))).not.toBe(passId('57166', new Date('2026-10-02T19:20:00Z')));
    expect(passId('59051', new Date('2026-10-02T19:20:00Z'))).not.toBe(passId('59051', new Date('2026-10-02T21:00:00Z')));
  });
});

describe('findPassById', () => {
  const passes = [make('59051', '2026-10-02T19:20:00Z'), make('57166', '2026-10-02T19:20:30Z'), make('59051', '2026-10-02T21:00:00Z')];

  it('finds an exact match', () => {
    expect(findPassById(passes, passes[2].id)).toBe(passes[2]);
  });

  it('still finds the pass when its rise time shifted across a minute boundary', () => {
    const staleId = passId('59051', new Date('2026-10-02T19:19:59.500Z'));
    expect(findPassById(passes, staleId)).toBe(passes[0]);
  });

  it('does not confuse satellites or return far-away passes', () => {
    expect(findPassById(passes, passId('59051', new Date('2026-10-02T20:00:00Z')))).toBeUndefined();
    expect(findPassById(passes, 'garbage')).toBeUndefined();
    expect(findPassById(passes, '59051-notanumber')).toBeUndefined();
  });
});
