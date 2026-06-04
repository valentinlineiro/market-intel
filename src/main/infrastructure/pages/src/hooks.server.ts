import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit';
import { validateSession } from '$lib/auth.js';

const PUBLIC_PATHS = new Set(['/login', '/api/signup']);
const PUBLIC_PREFIXES = ['/landings/'];

export const handle: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;
  const isPublic = PUBLIC_PATHS.has(path) || PUBLIC_PREFIXES.some(p => path.startsWith(p));

  if (!isPublic) {
    const token    = event.cookies.get('session');
    const platform = event.platform as App.Platform;
    const valid    = token ? await validateSession(token, platform.env.SESSION_SECRET) : false;
    if (!valid) throw redirect(302, '/login');
    event.locals.session = { authenticated: true };
  }

  return resolve(event);
};
