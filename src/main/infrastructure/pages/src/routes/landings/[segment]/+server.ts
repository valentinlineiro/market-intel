import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, platform }) => {
  const env = (platform as App.Platform).env;
  const res = await fetch(`${env.WORKER_URL}/public/landings/${params.segment}`);
  if (!res.ok) return new Response('Not found', { status: 404 });
  const html = await res.text();
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
};
