const enc = new TextEncoder();

async function hmacSign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function signSession(secret: string): Promise<string> {
  const expiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = String(expiry);
  const sig = await hmacSign(secret, payload);
  return `${payload}.${sig}`;
}

export async function validateSession(token: string, secret: string): Promise<boolean> {
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx < 0) return false;
  const payload = token.slice(0, dotIdx);
  const sig     = token.slice(dotIdx + 1);
  const expiry  = parseInt(payload, 10);
  if (isNaN(expiry) || Date.now() > expiry) return false;
  const expected = await hmacSign(secret, payload);
  return sig === expected;
}
