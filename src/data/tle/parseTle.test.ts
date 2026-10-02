import { parseTleText } from './parseTle';

const SAMPLE = `ISS (ZARYA)
1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9000
2 25544  51.6400 208.9163 0006317  69.9862  25.2906 15.49560000000000
NOAA 15
1 25338U 98030A   24001.50000000  .00000170  00000-0  10175-3 0  9004
2 25338  98.6210  10.0000 0010630  60.0000 300.0000 14.25000000000000`;

describe('parseTleText', () => {
  it('parses multiple three-line TLE records', () => {
    const records = parseTleText(SAMPLE);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      noradId: '25544',
      name: 'ISS (ZARYA)',
    });
    expect(records[0].line1.startsWith('1 25544U')).toBe(true);
    expect(records[1].noradId).toBe('25338');
  });

  it('ignores blank lines', () => {
    const records = parseTleText(`\n${SAMPLE}\n\n`);
    expect(records).toHaveLength(2);
  });
});
