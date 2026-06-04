const enc = new TextEncoder();

async function importKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, usages,
  );
}

export async function signSession(secret: string): Promise<string> {
  const expiry  = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = enc.encode(String(expiry));
  const key     = await importKey(secret, ['sign']);
  const sig     = await crypto.subtle.sign('HMAC', key, payload);
  const hex     = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${expiry}.${hex}`;
}

export async function validateSession(token: string, secret: string): Promise<boolean> {
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx < 0) return false;
  const payload = token.slice(0, dotIdx);
  const sigHex  = token.slice(dotIdx + 1);
  const expiry  = parseInt(payload, 10);
  if (isNaN(expiry) || Date.now() > expiry) return false;
  const sigBytes = new Uint8Array(sigHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
  const key      = await importKey(secret, ['verify']);
  return crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload));
}
