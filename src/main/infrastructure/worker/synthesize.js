import { callLLM } from "./llm.js";
import { getConfig } from "./config.js";

const SYNTHESIS_PROMPT = `Eres un copywriter B2B especializado en SaaS para profesionales autónomos españoles.

Tu tarea: escribir el copy de una landing page de validación usando ÚNICAMENTE el lenguaje que aparece en las quejas reales que te doy. Nada de marketing genérico.

CONTEXTO:
- Perfil objetivo: {segment_label}
- Dolores más mencionados: {top_keywords}
- Salario medio del segmento: {salary_mean}€/año
{deadline_note}

REGLAS:
1. El headline debe nombrar el PROBLEMA, no la solución. Usa palabras del corpus.
2. El subtitle amplía el problema con datos concretos.
3. Cada uno de los 3 beneficios resuelve uno de los 3 dolores más frecuentes.
4. El CTA genera urgencia sin ser agresivo (no uses "GRATIS" ni "AHORA").
5. Todo en español. Tono directo, sin eufemismos corporativos.

Devuelve ÚNICAMENTE JSON válido, sin texto previo ni backticks:
{"headline":"...","subtitle":"...","benefits":[{"title":"...","desc":"...","emoji":"..."},{"title":"...","desc":"...","emoji":"..."},{"title":"...","desc":"...","emoji":"..."}],"cta":"..."}`;

export async function synthesizeCopy(segment, env) {
  const cfg = await getConfig(env.DB);
  const seg = cfg.synthesis_segments[segment] || { label: segment, keywords: [], salary_mean: "N/A" };
  const prompt = SYNTHESIS_PROMPT
    .replace("{segment_label}", seg.label)
    .replace("{top_keywords}", seg.keywords.join(", "))
    .replace("{salary_mean}", String(seg.salary_mean))
    .replace("{deadline_note}", "");

  let raw = await callLLM(prompt, env, { maxTokens: 800 });
  if (raw.startsWith("```")) {
    raw = raw.split("```")[1];
    if (raw.startsWith("json")) raw = raw.slice(4).trim();
  }
  const parsed = JSON.parse(raw);
  return {
    title:    parsed.headline,
    subtitle: parsed.subtitle,
    benefits: parsed.benefits.slice(0, 3).map(b => [b.title, b.desc, b.emoji]),
    cta:      parsed.cta,
  };
}

export function buildHtml(segment, copy) {
  const { title, subtitle, benefits = [], cta = "Quiero acceso prioritario" } = copy;

  const benefitsHtml = benefits.map(([t, d, e]) =>
    `<div class="benefit"><span class="emoji">${e || ""}</span><h3>${t}</h3><p>${d}</p></div>`
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #020817; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { max-width: 680px; padding: 48px 24px; text-align: center; }
    h1 { font-size: clamp(1.8rem, 4vw, 2.8rem); font-weight: 800; color: #f1f5f9; line-height: 1.2; margin-bottom: 20px; }
    .subtitle { font-size: 1.1rem; color: #94a3b8; margin-bottom: 40px; line-height: 1.6; }
    .benefits { display: grid; gap: 20px; margin-bottom: 40px; text-align: left; }
    .benefit { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; }
    .emoji { font-size: 1.5rem; }
    .benefit h3 { font-size: 1rem; font-weight: 700; color: #f1f5f9; margin: 8px 0 4px; }
    .benefit p { font-size: 0.875rem; color: #64748b; line-height: 1.5; }
    form { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
    input[type=email] { flex: 1; min-width: 220px; padding: 14px 18px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #f1f5f9; font-size: 1rem; }
    button { padding: 14px 28px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
    button:hover { background: #2563eb; }
    .success { display: none; color: #22c55e; margin-top: 16px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${title}</h1>
    <p class="subtitle">${subtitle}</p>
    <div class="benefits">${benefitsHtml}</div>
    <form id="form" action="/signup" method="POST">
      <input type="hidden" name="segment" value="${segment}">
      <input type="email" name="email" placeholder="tu@email.com" required>
      <button type="submit">${cta}</button>
    </form>
    <p class="success" id="ok">✓ Apuntado. Te avisamos primero.</p>
  </div>
  <script>
    document.getElementById('form').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await fetch('/signup', {method:'POST', body: new URLSearchParams(fd)});
      e.target.style.display = 'none';
      document.getElementById('ok').style.display = 'block';
    });
  </script>
</body>
</html>`;
}
