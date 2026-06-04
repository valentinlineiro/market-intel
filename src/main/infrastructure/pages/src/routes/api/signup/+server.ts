import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, platform }) => {
  const env = (platform as App.Platform).env;
  const body = await request.text();
  const res = await fetch(`${env.WORKER_URL}/public/signup`, {
    method: 'POST',
    headers: { 'Content-Type': request.headers.get('Content-Type') || 'application/json' },
    body,
  });
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
};
