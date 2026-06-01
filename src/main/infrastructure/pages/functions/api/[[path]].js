export async function onRequest({ request, env, params }) {
  const workerUrl = (env.WORKER_URL || "").replace(/\/$/, "");
  const secret    = env.WORKER_SECRET || "";

  if (!workerUrl || !secret) {
    return new Response(
      JSON.stringify({ error: "WORKER_URL or WORKER_SECRET not configured in Pages env" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  const path = params.path ? (Array.isArray(params.path) ? params.path.join("/") : params.path) : "";
  const target = `${workerUrl}/${path}`;

  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${secret}`);
  headers.delete("host");

  const proxied = new Request(target, {
    method:  request.method,
    headers,
    body:    ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
  });

  return fetch(proxied);
}
