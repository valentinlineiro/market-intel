/**
 * functions/signup.js — Cloudflare Pages Function
 *
 * Recibe POST /signup, guarda lead en D1 y notifica Telegram.
 *
 * Bindings requeridos (wrangler.toml + wrangler pages secret put):
 *   DB               — D1 database binding
 *   TELEGRAM_TOKEN   — secret
 *   TELEGRAM_CHAT_ID — secret
 */

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  try {
    const ct = request.headers.get("content-type") || "";
    let email = "", segment = "unknown";

    if (ct.includes("application/x-www-form-urlencoded")) {
      const body = await request.formData();
      email   = (body.get("email")   || "").trim();
      segment = (body.get("segment") || "unknown").trim();
    } else if (ct.includes("application/json")) {
      const body = await request.json();
      email   = (body.email   || "").trim();
      segment = (body.segment || "unknown").trim();
    } else {
      return json({ error: "Content-Type no soportado" }, 415);
    }

    if (!email || !email.includes("@") || !email.includes("."))
      return json({ error: "Email inválido" }, 400);

    // Guardar en D1
    if (env.DB) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO leads (email, segment, captured_at, ip, ua)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(
        email,
        segment,
        new Date().toISOString(),
        request.headers.get("CF-Connecting-IP") || "unknown",
        request.headers.get("User-Agent")       || "unknown",
      ).run();
    }

    // Notificar Telegram
    if (env.TELEGRAM_TOKEN && env.TELEGRAM_CHAT_ID) {
      await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id:    env.TELEGRAM_CHAT_ID,
            text:       `✉️ *Nuevo lead*\n*Segmento:* ${segment}\n*Email:* \`${email}\``,
            parse_mode: "Markdown",
          }),
        }
      ).catch(e => console.error("Telegram:", e.message));
    }

    return json({ status: "ok" }, 200);

  } catch (err) {
    console.error("signup:", err);
    return json({ error: "server error" }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
