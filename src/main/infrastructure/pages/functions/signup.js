/**
 * functions/signup.js — Cloudflare Pages Function
 *
 * Recibe POST /signup, guarda lead en D1 y notifica por email.
 *
 * Bindings requeridos:
 *   DB                        — D1 database binding
 *   EMAIL                     — send_email binding
 *   NOTIFICATION_EMAIL_FROM   — dirección from (dominio verificado)
 *   NOTIFICATION_EMAIL_RECIPIENT — destinatario de notificaciones
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

    // Notificar por email
    if (env.EMAIL && env.NOTIFICATION_EMAIL_RECIPIENT && env.NOTIFICATION_EMAIL_FROM) {
      env.EMAIL.send({
        to: env.NOTIFICATION_EMAIL_RECIPIENT,
        from: { email: env.NOTIFICATION_EMAIL_FROM, name: "Market Intel" },
        subject: `Nuevo lead: ${segment}`,
        html: `<h2>Nuevo lead</h2><p><strong>Segmento:</strong> ${segment}</p><p><strong>Email:</strong> ${email}</p>`,
        text: `Nuevo lead\nSegmento: ${segment}\nEmail: ${email}`,
      }).catch(e => console.error("Email:", e.message));
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
