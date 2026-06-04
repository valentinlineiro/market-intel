import type { RequestHandler } from './$types';

export const GET: RequestHandler     = (e) => proxy(e);
export const POST: RequestHandler    = (e) => proxy(e);
export const PUT: RequestHandler     = (e) => proxy(e);
export const DELETE: RequestHandler  = (e) => proxy(e);
export const OPTIONS: RequestHandler = (e) => proxy(e);

async function proxy({ request, params, platform, url }: Parameters<RequestHandler>[0]): Promise<Response> {
  const env = (platform as App.Platform).env;
  const workerPath = '/' + (params.path ?? '');
  const workerUrl  = env.WORKER_URL.replace(/\/$/, '') + workerPath + (url.search || '');

  const headers = new Headers(request.headers);
  headers.set('Authorization', `Bearer ${env.WORKER_SECRET}`);
  headers.delete('host');

  return fetch(workerUrl, {
    method:  request.method,
    headers,
    body:    ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    // @ts-expect-error — CF Workers supports duplex
    duplex: 'half',
  });
}
