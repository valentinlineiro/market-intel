import type { LandingCopy } from './types.js';

export async function synthesizeCopy(segment: string): Promise<{ copy: LandingCopy; html: string }> {
  const res = await fetch('/api/synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ segment }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const data = await res.json() as { copy: LandingCopy; html: string };
  return { copy: data.copy, html: data.html };
}
