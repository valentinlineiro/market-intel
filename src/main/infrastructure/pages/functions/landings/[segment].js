export async function onRequest({ params, env }) {
  const segment = params.segment;
  if (!env.DB) return new Response("DB binding missing", { status: 503 });

  const row = await env.DB.prepare(
    "SELECT html FROM landing_pages WHERE segment = ?"
  ).bind(segment).first();

  if (!row) return new Response("Landing page not found", { status: 404 });

  return new Response(row.html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
