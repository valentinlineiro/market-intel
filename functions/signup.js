/**
 * functions/signup.js
 *
 * Cloudflare Pages Function — maneja POST /signup desde cualquier landing.
 * Se despliega automáticamente junto con el HTML estático via wrangler.
 *
 * Bindings requeridos en Cloudflare dashboard (o wrangler.toml):
 *   LEADS_KV          — KV Namespace para almacenar leads
 *   TELEGRAM_TOKEN    — Token del bot de Telegram
 *   TELEGRAM_CHAT_ID  — Chat ID donde enviar notificaciones
 *
 * Setup de KV:
 *   wrangler kv:namespace create LEADS_KV
 *   → Copia el id al wrangler.toml
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const contentType = request.headers.get("content-type") || "";
    let email = "", segment = "unknown";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const body = await request.formData();
      email   = (body.get("email")   || "").trim();
      segment = (body.get("segment") || "unknown").trim();
    } else if (contentType.includes("application/json")) {
      const body = await request.json();
      email   = (body.email   || "").trim();
      segment = (body.segment || "unknown").trim();
    } else {
      return json({ error: "Content-Type no soportado" }, 415);
    }

    // Validación básica
    if (!email || !email.includes("@") || !email.includes(".")) {
      return json({ error: "Email inválido" }, 400);
    }

    // Guardar en KV: key = lead:{segment}:{timestamp_ms}
    const key   = `lead:${segment}:${Date.now()}`;
    const value = JSON.stringify({
      email,
      segment,
      ts:  new Date().toISOString(),
      ip:  request.headers.get("CF-Connecting-IP") || "unknown",
      ua:  request.headers.get("User-Agent")       || "unknown",
    });

    if (env.LEADS_KV) {
      await env.LEADS_KV.put(key, value);
    } else {
      console.warn("LEADS_KV no configurado — lead no persistido");
    }

    // Notificar por Telegram
    if (env.TELEGRAM_TOKEN && env.TELEGRAM_CHAT_ID) {
      await notifyTelegram(env, segment, email).catch(err =>
        console.error("Telegram notify falló:", err.message)
      );
    }

    return json({ status: "ok" }, 200);

  } catch (err) {
    console.error("signup error:", err);
    return json({ error: "server error" }, 500);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function notifyTelegram(env, segment, email) {
  const text = `✉️ *Nuevo lead*\n*Segmento:* ${segment}\n*Email:* \`${email}\``;
  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id:    env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: "Markdown",
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram API ${res.status}: ${err}`);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
