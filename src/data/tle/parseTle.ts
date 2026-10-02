import { TleRecord } from '../../types/satellite';

export function parseTleText(raw: string): TleRecord[] {
  const lines = raw.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);

  const records: TleRecord[] = [];
  for (let i = 0; i + 2 < lines.length + 1 && i < lines.length; i += 3) {
    const name = lines[i]?.trim();
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (!name || !line1?.startsWith('1 ') || !line2?.startsWith('2 ')) continue;

    const noradId = line1.substring(2, 7).trim();
    records.push({ noradId, name, line1, line2 });
  }
  return records;
}
