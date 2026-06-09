import type { ILLMProvider } from './ports.js';
import type { SegmentConfig } from '../domain/types.js';

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
{"headline":"...","subheadline":"...","pain_points":["...","...","..."],"cta":"..."}`;

export interface SynthesisCopy {
  headline: string;
  subheadline: string;
  cta: string;
  pain_points: string[];
}

export async function synthesizeCopy(
  segment: string,
  segmentConfig: SegmentConfig,
  llm: ILLMProvider,
): Promise<SynthesisCopy> {
  const salaryMean = 'salary_mean' in segmentConfig
    ? String((segmentConfig as SegmentConfig & { salary_mean?: number }).salary_mean ?? 'N/A')
    : 'N/A';
  const deadlineNote = segmentConfig.has_deadline ? 'Deadline activo para este segmento.' : '';

  const prompt = SYNTHESIS_PROMPT
    .replace('{segment_label}', segmentConfig.label)
    .replace('{top_keywords}', segmentConfig.keywords.join(', '))
    .replace('{salary_mean}', salaryMean)
    .replace('{deadline_note}', deadlineNote);

  let raw = await llm.complete(prompt, 800);
  if (raw.startsWith('```')) {
    raw = raw.split('```')[1];
    if (raw.startsWith('json')) raw = raw.slice(4).trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`LLM returned invalid JSON for synthesis of segment '${segment}': ${raw.slice(0, 200)}`);
  }

  const typedParsed = parsed as {
    headline?: string;
    subheadline?: string;
    subtitle?: string;
    pain_points?: string[];
    benefits?: Array<{ title: string; desc: string; emoji?: string }>;
    cta?: string;
  };

  // Support both the new schema (headline/subheadline/pain_points) and the legacy
  // schema (headline/subtitle/benefits) in case the LLM returns the old format.
  const headline = typedParsed.headline ?? segment;
  const subheadline = typedParsed.subheadline ?? typedParsed.subtitle ?? '';
  const cta = typedParsed.cta ?? 'Quiero acceso prioritario';

  let pain_points: string[];
  if (Array.isArray(typedParsed.pain_points) && typedParsed.pain_points.length > 0) {
    pain_points = typedParsed.pain_points.slice(0, 3) as string[];
  } else if (Array.isArray(typedParsed.benefits) && typedParsed.benefits.length > 0) {
    pain_points = typedParsed.benefits.slice(0, 3).map(b => b.title);
  } else {
    pain_points = [];
  }

  return { headline, subheadline, cta, pain_points };
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildHtml(
  segment: string,
  copy: SynthesisCopy,
): string {
  const { headline, subheadline, cta = 'Quiero acceso prioritario', pain_points = [] } = copy;

  const painPointsHtml = pain_points
    .map(p => `<div class="benefit"><p>${escHtml(p)}</p></div>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(headline)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #020817; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { max-width: 680px; padding: 48px 24px; text-align: center; }
    h1 { font-size: clamp(1.8rem, 4vw, 2.8rem); font-weight: 800; color: #f1f5f9; line-height: 1.2; margin-bottom: 20px; }
    .subtitle { font-size: 1.1rem; color: #94a3b8; margin-bottom: 40px; line-height: 1.6; }
    .benefits { display: grid; gap: 20px; margin-bottom: 40px; text-align: left; }
    .benefit { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; }
    .benefit p { font-size: 0.875rem; color: #64748b; line-height: 1.5; }
    form { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
    input[type=email] { flex: 1; min-width: 220px; padding: 14px 18px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #f1f5f9; font-size: 1rem; }
    button { padding: 14px 28px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
    button:hover { background: #2563eb; }
    .price-step { display: none; margin-top: 24px; }
    .price-step p { color: #94a3b8; margin-bottom: 16px; font-size: 0.95rem; }
    .price-step strong { color: #f1f5f9; }
    .tiers { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
    .tier { padding: 10px 20px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #94a3b8; font-size: 0.9rem; cursor: pointer; transition: border-color .15s, color .15s; }
    .tier:hover { border-color: #3b82f6; color: #f1f5f9; }
    .confirmed { display: none; color: #22c55e; margin-top: 20px; font-weight: 600; font-size: 1rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${escHtml(headline)}</h1>
    <p class="subtitle">${escHtml(subheadline)}</p>
    <div class="benefits">${painPointsHtml}</div>
    <form id="form">
      <input type="hidden" id="segment" value="${escHtml(segment)}">
      <input type="email" id="email" placeholder="tu@email.com" required>
      <button type="submit">${escHtml(cta)}</button>
    </form>
    <div class="price-step" id="price-step">
      <strong>¡Apuntado!</strong>
      <p>Una última pregunta: ¿cuánto pagarías al mes por una solución?</p>
      <div class="tiers">
        <button class="tier" data-tier="0-10">€0–10</button>
        <button class="tier" data-tier="10-30">€10–30</button>
        <button class="tier" data-tier="30-50">€30–50</button>
        <button class="tier" data-tier="50+">€50+</button>
      </div>
    </div>
    <p class="confirmed" id="confirmed">✓ Gracias. Te avisamos primero.</p>
  </div>
  <script>
    var seg = document.getElementById('segment').value;
    var email = '';

    document.getElementById('form').addEventListener('submit', async function(e) {
      e.preventDefault();
      email = document.getElementById('email').value;
      await fetch('/public/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, segment: seg }),
      });
      e.target.style.display = 'none';
      document.getElementById('price-step').style.display = 'block';
    });

    document.querySelectorAll('.tier').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var tier = this.getAttribute('data-tier');
        await fetch('/public/signup/price', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, segment: seg, price_tier: tier }),
        });
        document.getElementById('price-step').style.display = 'none';
        document.getElementById('confirmed').style.display = 'block';
      });
    });
  </script>
</body>
</html>`;
}
