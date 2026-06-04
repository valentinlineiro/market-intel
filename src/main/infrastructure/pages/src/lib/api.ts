import type { LandingCopy } from './types.js';

export async function synthesizeCopy(segment: string): Promise<LandingCopy> {
  const res = await fetch('/api/synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segment }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const data = await res.json() as { copy: LandingCopy };
  return data.copy;
}
